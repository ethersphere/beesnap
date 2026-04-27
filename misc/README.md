# Misc maintenance scripts

One-off or rare tools. They are **not** part of the Snap or the install site.

## Registry export

`export_registry_data.js` — fetches `BatchCreated` events from a registry contract on Gnosis and writes `registry_data.json` in this directory.

```bash
cd misc
# Optional: GNOSIS_RPC_URL=... 
node export_registry_data.js
```

## Other files

- `import_registry_data.js` — import / migration helper (read the script before use).
- `testFromBZZ.js`, `testFromUSD.js`, `testTo.js`, `testCC.js` — ad-hoc test scripts; safe to delete locally if you do not use them.
