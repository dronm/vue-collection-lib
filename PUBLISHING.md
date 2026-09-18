# Publishing @katren/vue-collection-lib

## Account preparation

The npm account or organization must own the `@katren` scope, and the publishing user must have permission to create or update the package.

Direct npm publishing requires either:

- two-factor authentication enabled for publishing; or
- a granular access token that is permitted to bypass 2FA.

Authenticate and verify the active account:

```bash
npm login
npm whoami
```

Confirm that npm uses the public registry:

```bash
npm config get registry
```

The expected value is:

```text
https://registry.npmjs.org/
```

The package also fixes the publish registry through `publishConfig`.

## Release checks

From the package root:

```bash
npm ci
npm run check
npm pack --dry-run
```

Create the actual tarball when a consumer-project test is required:

```bash
npm pack
```

Install that tarball in a test application:

```bash
npm install /absolute/path/to/katren-vue-collection-lib-<version>.tgz
npm run build
```

Delete the generated `.tgz` after testing if it must not be committed.

## Choose a version

A published npm version is immutable and cannot be published again. The package in this archive is version `0.1.10`. Check the current registry version before publishing:

```bash
npm view @katren/vue-collection-lib version
```

If the registry version is lower than `0.1.10`, publish this archive without another version change. If `0.1.10` already exists, update the package version according to semantic versioning:

```bash
npm version patch
```

Use `minor` for backward-compatible features and `major` for breaking changes:

```bash
npm version minor
npm version major
```

`npm version` updates `package.json` and `package-lock.json`, creates a Git commit, and creates a Git tag unless npm is configured otherwise.

## Publish

For the first public release of a scoped package:

```bash
npm publish --access public
```

`package.json` already contains:

```json
{
	"publishConfig": {
		"access": "public",
		"registry": "https://registry.npmjs.org/"
	}
}
```

Therefore this also works:

```bash
npm publish
```

Using `--access public` explicitly on the first release makes the intent clear.

If npm asks for a one-time password:

```bash
npm publish --access public --otp=123456
```

## Verify the release

```bash
npm view @katren/vue-collection-lib version
npm view @katren/vue-collection-lib dist-tags
npm install @katren/vue-collection-lib@latest
```

Push the release commit and tag:

```bash
git push

git push --tags
```

Or:

```bash
git push --follow-tags
```

## Subsequent release sequence

```bash
npm ci
npm run check
npm version patch
npm publish
git push --follow-tags
```

## Prerelease versions

For an RC or beta:

```bash
npm version prerelease --preid=rc
npm publish --tag next
```

Consumers install it explicitly:

```bash
npm install @katren/vue-collection-lib@next
```

Do not publish prerelease builds under the `latest` tag unless they are intended to replace the stable version.

## CI publishing

For automated releases, prefer npm trusted publishing through an OpenID Connect-enabled CI workflow rather than a long-lived npm token. Trusted publishing can also attach package provenance to the release.
