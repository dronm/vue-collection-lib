export type EventCallback = (eventId: string, payload: unknown) => void;
export type ConnectionCallback = (param?: unknown) => void;

export interface EventSubscription {
	events: string[];
	onEvent?: EventCallback;
	onOpen?: ConnectionCallback;
	onClose?: ConnectionCallback;
	onError?: ConnectionCallback;
	onSubscribed?: ConnectionCallback;
	onWakeup?: ConnectionCallback;
}

export interface WSManagerOptions {
	debug?: boolean;
	reconnectInterval?: number;
	maxReconnectAttempts?: number;
}

interface ClientMessage {
	f: string;
	p?: unknown;
	q: string;
}

interface ServerError {
	code?: string;
	message?: string;
}

interface ServerMessage {
	query_id?: string;
	event_id?: string;
	payload?: unknown;
	error?: ServerError | null;
}

const EVENT_SUBSCRIBE = "Event.Subscribe";
const EVENT_UNSUBSCRIBE = "Event.Unsubscribe";
const RESPONSE_EVENT = "Response";
const DEFAULT_RECONNECT_INTERVAL = 3000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;

const makeQueryId = (): string => {
	if (typeof globalThis.crypto?.randomUUID === "function") {
		return globalThis.crypto.randomUUID();
	}

	return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const normalizeEvents = (events: string[]): string[] => {
	return [...new Set(
		events
			.map((eventId) => eventId.trim())
			.filter((eventId) => eventId !== ""),
	)];
};

const resolveWebSocketURL = (value: string): string => {
	const url = value.trim();
	if (url === "") {
		throw new Error("WebSocket URL is empty");
	}

	if (/^wss?:\/\//i.test(url)) {
		return url;
	}

	if (/^https?:\/\//i.test(url)) {
		return url.replace(/^http/i, "ws");
	}

	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	if (url.startsWith("//")) {
		return `${protocol}${url}`;
	}

	if (url.startsWith("/")) {
		return `${protocol}//${window.location.host}${url}`;
	}

	return `${protocol}//${url}`;
};

export class WSManager {
	private readonly url: string;
	private readonly debug: boolean;
	private readonly reconnectInterval: number;
	private readonly maxReconnectAttempts: number;

	private connection: WebSocket | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private reconnectAttempts = 0;
	private manualDisconnect = false;

	private readonly subscriptions = new Map<string, EventSubscription>();
	private readonly eventGroups = new Map<string, Set<string>>();
	private readonly serverSubscriptions = new Set<string>();

	public lastConnOpenTime: number | undefined;

	constructor(url: string, options: WSManagerOptions = {}) {
		this.url = url;
		this.debug = options.debug ?? false;
		this.reconnectInterval = options.reconnectInterval
			?? DEFAULT_RECONNECT_INTERVAL;
		this.maxReconnectAttempts = options.maxReconnectAttempts
			?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
	}

	public connect(): void {
		if (!("WebSocket" in window)) {
			throw new Error("WebSocket is not supported in this browser");
		}

		if (
			this.connection?.readyState === WebSocket.OPEN
			|| this.connection?.readyState === WebSocket.CONNECTING
		) {
			return;
		}

		this.manualDisconnect = false;
		this.clearReconnectTimer();
		this.setupConnection();
	}

	public disconnect(): void {
		this.manualDisconnect = true;
		this.clearReconnectTimer();
		this.serverSubscriptions.clear();
		this.clearSubscriptions();

		const connection = this.connection;
		this.connection = null;
		if (
			connection !== null
			&& connection.readyState !== WebSocket.CLOSED
		) {
			connection.close(1000, "client disconnect");
		}
	}

	public isConnected(): boolean {
		return this.connection?.readyState === WebSocket.OPEN;
	}

	public subscribe(
		subscription: EventSubscription,
		groupId = makeQueryId(),
	): string {
		const events = normalizeEvents(subscription.events);
		if (events.length === 0) {
			throw new Error("At least one event is required for a WebSocket subscription");
		}

		if (this.subscriptions.has(groupId)) {
			this.unsubscribe(groupId);
		}

		const normalizedSubscription: EventSubscription = {
			...subscription,
			events,
		};
		this.subscriptions.set(groupId, normalizedSubscription);

		const eventsToSubscribe: string[] = [];
		for (const eventId of events) {
			let groups = this.eventGroups.get(eventId);
			if (!groups) {
				groups = new Set<string>();
				this.eventGroups.set(eventId, groups);
			}

			const wasUnused = groups.size === 0;
			groups.add(groupId);
			if (
				wasUnused
				&& this.isConnected()
				&& !this.serverSubscriptions.has(eventId)
			) {
				eventsToSubscribe.push(eventId);
			}
		}

		if (eventsToSubscribe.length > 0) {
			this.send(EVENT_SUBSCRIBE, { events: eventsToSubscribe });
			eventsToSubscribe.forEach((eventId) => {
				this.serverSubscriptions.add(eventId);
			});
			normalizedSubscription.onSubscribed?.();
		}

		this.log("subscribed", { groupId, events });
		return groupId;
	}

	public unsubscribe(groupId: string): void {
		const subscription = this.subscriptions.get(groupId);
		if (!subscription) {
			return;
		}

		this.subscriptions.delete(groupId);
		const eventsToUnsubscribe: string[] = [];

		for (const eventId of subscription.events) {
			const groups = this.eventGroups.get(eventId);
			if (!groups) {
				continue;
			}

			groups.delete(groupId);
			if (groups.size > 0) {
				continue;
			}

			this.eventGroups.delete(eventId);
			if (this.serverSubscriptions.has(eventId)) {
				eventsToUnsubscribe.push(eventId);
				this.serverSubscriptions.delete(eventId);
			}
		}

		if (eventsToUnsubscribe.length > 0 && this.isConnected()) {
			this.send(EVENT_UNSUBSCRIBE, { events: eventsToUnsubscribe });
		}

		this.log("unsubscribed", { groupId, events: subscription.events });
	}

	private setupConnection(): void {
		const connection = new WebSocket(resolveWebSocketURL(this.url));
		this.connection = connection;
		this.log("connecting", { url: connection.url });

		connection.onopen = () => {
			if (this.connection !== connection) {
				return;
			}

			this.reconnectAttempts = 0;
			this.lastConnOpenTime = Date.now();
			this.serverSubscriptions.clear();
			this.subscribeAllOnServer();
			this.notifyConnectionEvent("onOpen");
			this.log("connected");
		};

		connection.onerror = (error) => {
			if (this.connection !== connection) {
				return;
			}

			this.notifyConnectionEvent("onError", error);
			this.log("connection error", error);
		};

		connection.onclose = (event) => {
			if (this.connection === connection) {
				this.connection = null;
			}

			this.serverSubscriptions.clear();
			this.notifyConnectionEvent("onClose", event);
			this.log("connection closed", {
				code: event.code,
				reason: event.reason,
			});

			if (!this.manualDisconnect) {
				this.scheduleReconnect();
			}
		};

		connection.onmessage = (message) => {
			this.handleMessage(message);
		};
	}

	private subscribeAllOnServer(): void {
		const events = [...this.eventGroups.keys()];
		if (events.length === 0 || !this.isConnected()) {
			return;
		}

		this.send(EVENT_SUBSCRIBE, { events });
		events.forEach((eventId) => {
			this.serverSubscriptions.add(eventId);
		});

		for (const subscription of this.subscriptions.values()) {
			subscription.onSubscribed?.();
		}
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimer !== null) {
			return;
		}

		if (
			this.maxReconnectAttempts > 0
			&& this.reconnectAttempts >= this.maxReconnectAttempts
		) {
			this.log("maximum reconnect attempts reached");
			return;
		}

		this.reconnectAttempts += 1;
		this.log("reconnect scheduled", {
			attempt: this.reconnectAttempts,
			delay: this.reconnectInterval,
		});

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			if (!this.manualDisconnect) {
				this.setupConnection();
			}
		}, this.reconnectInterval);
	}

	private clearReconnectTimer(): void {
		if (this.reconnectTimer === null) {
			return;
		}

		clearTimeout(this.reconnectTimer);
		this.reconnectTimer = null;
	}

	private notifyConnectionEvent(
		eventName: keyof Pick<
			EventSubscription,
			"onOpen" | "onClose" | "onError" | "onWakeup"
		>,
		param?: unknown,
	): void {
		for (const subscription of this.subscriptions.values()) {
			subscription[eventName]?.(param);
		}
	}

	private send(func: string, payload?: unknown): void {
		if (!this.isConnected() || this.connection === null) {
			return;
		}

		const message: ClientMessage = {
			f: func,
			q: makeQueryId(),
		};
		if (payload !== undefined) {
			message.p = payload;
		}

		this.log("send", message);
		this.connection.send(JSON.stringify(message));
	}

	private handleMessage(message: MessageEvent<string>): void {
		try {
			const data = JSON.parse(message.data) as ServerMessage;
			this.log("message", data);

			if (data.event_id === RESPONSE_EVENT) {
				if (data.error) {
					this.notifyConnectionEvent("onError", data.error);
				}
				return;
			}

			if (!data.event_id) {
				return;
			}

			const groupIds = this.eventGroups.get(data.event_id);
			if (!groupIds) {
				return;
			}

			for (const groupId of [...groupIds]) {
				const subscription = this.subscriptions.get(groupId);
				if (!subscription) {
					continue;
				}

				if (data.error) {
					subscription.onError?.(data.error);
					continue;
				}

				subscription.onEvent?.(data.event_id, data.payload);
			}
		} catch (error: unknown) {
			this.log("message handling error", error);
		}
	}

	private clearSubscriptions(): void {
		this.subscriptions.clear();
		this.eventGroups.clear();
	}

	private log(message: string, value?: unknown): void {
		if (!this.debug) {
			return;
		}

		if (value === undefined) {
			console.debug(`[WS] ${message}`);
			return;
		}

		console.debug(`[WS] ${message}`, value);
	}
}
