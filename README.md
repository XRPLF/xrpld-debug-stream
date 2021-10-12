# `XRPLD` Debug Stream (WebSocket)

## Built for the Hooks Testnet Debug Stream

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

1. Run Hooks Testnet (or other XRPL node)
```
  docker run -d --name xrpld-hooks \
    --network=host --restart=always \
    xrpllabsofficial/xrpld-hooks-testnet
```

2. Run websocketd to forward te container logs to a websocket

```
  websocketd --port=1400 \
    sh -c "docker exec xrpld-hooks tail -f /opt/xrpld-hooks/log"
``

3. Run this repository:
```
  npm run pm2
  # Now Monitor:
  pm2 monit XRPLD_DEBUG_STREAM
```
