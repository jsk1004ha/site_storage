# Changelog

## 2026-04-23
- Fixed the new-site flow so clicking `다음` advances to step 2 immediately after URL validation, while metadata autofill continues asynchronously.
- Added a regression test to ensure the `다음` handler does not block on metadata autofill.
