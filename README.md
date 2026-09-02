# `XRPLD` Debug Stream (WebSocket)

## Built for the Devnet Debug Stream

This service relies on the output of an existing WebSocket, e.g. 
`websocketd` running on the stdout of `xrpld`.

This service then connects to the upstream `websocketd` service and
allows clients to connect to this Debug Stream repo. using a WebSocket
connection.

The appended value (URL) is the value to be matched in the output
to forward to the specific client and must be an XRPL account address (r...)

Simple status (counters): available on `/status`

Once everything is running, a client can connect to:
```
  ws://{machine-where-this-is-running}:{port}/{xrpl-account-addr}
  # e.g.
  ws://localhost:8080/rwietsevLFg8XSmG3bEZzFein1g8RBqWDZ
```

This will filter debug logs for a mention of the address:
  `rwietsevLFg8XSmG3bEZzFein1g8RBqWDZ`

## Config

Environment variables:
- `CORS_ORIGINS` for public visitors, default: `*`
- `ENDPOINT` to find a WebSocket server broadcasting logs, defualt: `ws://localhost:1400`
- `PORT` to run on, default: `8080`

## Sampe `websocketd` service

1. Run Devnet (or other XRPL node)
```
  docker run -d --name xrpld-hooks \
    --network=host --restart=always \
    xrpllabsofficial/xrpld-hooks-testnet
```

2. Run websocketd to forward te container logs to a websocket

```
  websocketd --port=1400 \
    sh -c "docker exec vnode1 tail -f /opt/ripple/log/debug.log"

nohup websocketd --port=1400 \
  sh -c "docker exec vnode1 tail -f /opt/ripple/log/debug.log" &
```

3. Run this repository:
```
  npm run pm2
  # Now Monitor:
  pm2 monit XRPLD_DEBUG_STREAM
```


## Batch and contract traces

Besides account addresses the stream matches `BatchTrace[<parentBatchId>]` and
`WasmTrace[<txId>]` lines. WebSocket subscriptions:

```
  ws://{host}/batch                      every BatchTrace line
  ws://{host}/batch/{parentBatchId}      one batch
  ws://{host}/contract                   every WasmTrace line
  ws://{host}/contract/{txId}            one contract transaction
```

## Batch results after the fact

Each BatchTrace line (`<innerTxId> applied|failure: <TER>`) is also parsed and kept per parent
batch, so the outcome can be fetched after submission without having subscribed first:

```
  GET /batch/{parentBatchId}         JSON for programs (curl, fetch), the live page for browsers
  GET /batch/{parentBatchId}.json    always JSON
  GET /batches?limit=50              most recent batches, newest first
  GET /health                        { ok, upstream }
```

```
  curl https://debug.devnet.xrpl.org/batch/D5A1649061F21BCD145E8EFEBC3FD085876EE20695F46FACA86596CAB25EE271
  {
    "parent_batch_id": "D5A16490…",
    "first_seen": 1788369126146,
    "last_seen": 1788369126148,
    "inner_results": [
      { "hash": "F137AEA3…", "applied": true,  "result": "tesSUCCESS", "observations": [ ... ] },
      { "hash": "A056A319…", "applied": false, "result": "terPRE_SEQ", "observations": [ ... ] }
    ]
  }
```

`inner_results` is in the order the node applied the inner transactions, which is the order of
`RawTransactions`. Inner transactions the node never attempted (after a `tfUntilFailure` stop,
for example) are absent. The results are what this node logged while applying the batch: an
open-ledger trial apply and the consensus apply can differ, so every observation is kept and the
latest one is reported as `applied` / `result`.

Results do not expire unless `BATCH_RESULT_TTL` (seconds) is set. Raw messages served by
`/recent/...` still expire after 30 minutes.
