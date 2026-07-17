# Security Policy

Moitime is currently an early beta service. Please avoid entering real passwords or sensitive personal information while using it.

## Supported Versions

Only the latest deployed version is actively maintained.

| Version | Supported |
| --- | --- |
| Latest | Yes |
| Older versions | No |

## Reporting a Vulnerability

If you find a security issue, please do not open a public issue with exploit details.

Instead, contact the maintainer privately first:

- GitHub: [@sangjun121](https://github.com/sangjun121)

Please include:

- A short description of the issue
- Steps to reproduce
- Affected page or flow
- Potential impact
- Screenshots or logs if they help explain the issue

Do not include real passwords, API keys, access tokens, or other secrets in your report.

## Scope

Security reports are especially helpful for:

- Exposed secrets or credentials
- Authentication or participant edit bypasses
- Unauthorized access to meeting data
- Stored or reflected XSS
- Unsafe handling of user-provided input
- Broken access control around meeting links or responses

## Out of Scope

The following are not currently treated as security vulnerabilities:

- Missing features
- UI bugs without security impact
- Reports requiring access to private accounts or secrets
- Denial-of-service reports based only on high request volume

## Response

I will review valid reports as soon as possible and prioritize fixes based on impact and reproducibility.
