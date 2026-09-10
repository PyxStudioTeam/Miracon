## Summary

Describe the user-facing or operational change and why it is needed.

## Verification

- [ ] `npm run release:verify`
- [ ] Relevant guarded disposable-database suite, or not applicable with a reason below
- [ ] Relevant browser flow, or not applicable with a reason below
- [ ] Release artifact inspected when packaging changed

Commands and observed results:

## Release and security review

- [ ] No credentials, local data, generated `dist/`, or workstation artifacts are included
- [ ] Database changes include an ordered PostgreSQL migration
- [ ] Public/admin mutations preserve same-origin, session, and CSRF boundaries
- [ ] Operational or cPanel prerequisites are documented

## Manual prerequisites or follow-up

List work that cannot be completed in the repository, such as cPanel, proxy, DNS, TLS, or scheduler configuration. Write `None` when there is none.
