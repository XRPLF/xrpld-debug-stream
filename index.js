const log = require('debug')('stream')
const log_redis = log.extend('redis')

const ioredis = require('ioredis')
const express = require('express')
const bodyParser = require('body-parser')
const cors = require('cors')
const helmet = require('helmet')
const morganDebug = require('morgan-debug')
const addressCodec = require('ripple-address-codec')
const W3CWebSocket = require('websocket').w3cwebsocket
require('dotenv').config()

let upstreamMessageCount = 0
let upstreamConnectCount = 0

const redis = new ioredis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  tls: [1, '1', true, 'true', 'yes', 'YES', 'y', 'Y'].indexOf(process.env.REDIS_TLS) > -1,
  autoResendUnfulfilledCommands: true,
  maxRetriesPerRequest: null
})

redis.on('connect', _ => log_redis('REDIS connected'))
redis.on('ready', _ => log_redis('REDIS ready'))
redis.on('close', _ => log_redis('REDIS disconnected'))
redis.on('error', e => log_redis('Error', e))

const tempStoreMsg = (type, hash, message) => {
  try {
    const key = hash + '_' + new Date() / 1 + '_' + upstreamMessageCount
    const exp = 60 * 30 // 60 seconds times 30 minutes

    // log_redis('set', key)
    redis.set(`msg:${type}:` + key, message, 'ex', exp)
    redis.incr(`${type}:` + hash)
    redis.expire(`${type}:` + hash, exp)
  } catch (e) {
    log_redis('Error', e)
  }
}

const streamClientMessage = msg => {
  if (msg !== '') {
    if (msg.match(/reportConsensusStateChange/)) return

    upstreamMessageCount++    
    
    // Handle XRPL Account addresses (r-addresses)
    const rAddrMatch = msg.match(/r[a-zA-Z0-9]{20,}/g)
    // console.log(`rAddrMatch: ${rAddrMatch}`);
    
    
    // Handle BatchTrace [ParentBatchId]
    const batchTraceMatch = msg.match(/BatchTrace\[([A-F0-9]{64})\]/g)
    // console.log(`batchTraceMatch: ${batchTraceMatch}`);
    
    // Handle WAMR [TxId]
    const wamrMatch = msg.match(/WasmTrace\[([A-F0-9]{64})\]/g)
    // console.log(`wamrMatch: ${wamrMatch}`);

    if (rAddrMatch) {
      const uniqueAccounts = [...new Set(rAddrMatch)]

      log('MSG for accounts', uniqueAccounts.join(', '))
      uniqueAccounts.forEach(account => {
        tempStoreMsg('account', account, msg)

        expressWs.getWss().clients.forEach(c => {
          if (c?.subscriptionType === 'account' && c?.account === account) {
            c.send(msg)
            c.messages++
          }
        })
      })
    }

    if (batchTraceMatch) {
      const uniqueBatches = [...new Set(batchTraceMatch.map(match => {
        const hashMatch = match.match(/BatchTrace\[([A-F0-9]{64})\]/)
        return hashMatch ? hashMatch[1] : null
      }).filter(Boolean))]

      log('MSG for batches', uniqueBatches.join(', '))
      uniqueBatches.forEach(batchHash => {
        tempStoreMsg('batch', batchHash, msg)

        expressWs.getWss().clients.forEach(c => {
          if (c?.subscriptionType === 'batch' && (!c?.hash || c?.hash === batchHash)) {
            c.send(msg)
            c.messages++
          }
        })
      })
    }

    if (wamrMatch) {
      const uniqueContracts = [...new Set(wamrMatch.map(match => {
        const hashMatch = match.match(/WasmTrace\[([A-F0-9]{64})\]/)
        return hashMatch ? hashMatch[1] : null
      }).filter(Boolean))]

      log('MSG for contracts', uniqueContracts.join(', '))
      uniqueContracts.forEach(contractHash => {
        tempStoreMsg('contract', contractHash, msg)

        expressWs.getWss().clients.forEach(c => {
          console.log(c?.subscriptionType);
          console.log(c?.hash);
          console.log(contractHash);
          
          if (c?.subscriptionType === 'contract' && (!c?.hash || c?.hash === contractHash)) {
            c.send(msg)
            c.messages++
          }
        })
      })
    }
  }
}

let upstreamConnected = false

const startStreamClient = () => {
  upstreamConnectCount++

  log('Start Stream Client')
  console.log(process.env?.ENDPOINT);
  
  const client = new W3CWebSocket(process.env?.ENDPOINT || 'ws://localhost:1400')

  const destruct = () => {
    client.onerror = null
    client.onmessage = null
    client.onopen = null
    client.onclose = null
    delete client
    upstreamConnected = false
  }

  let timeout = setTimeout(() => {
    log('DESTRUCT, COULD NOT CONNECT')
    destruct()
  }, 5000)

  client.onerror = () => {
    log('UPSTREAM Connection Error')

    destruct()
  }
  
  client.onopen = () => {
    log('UPSTREAM  WebSocket Client Connected', client.readyState === client.OPEN)
    upstreamConnected = true
    clearTimeout(timeout)
  }
  
  client.onclose = () => {
    log('UPSTREAM Client Closed')

    destruct()
  }

  let data = ''
  let flushTimeout
  
  client.onmessage = e => {
    if (typeof e.data === 'string') {
      if (e.data.match(/INSERT INTO AccountTransactions/)) {
        console.log('Skipping AccountTransactions message')
        return
      }

      clearTimeout(flushTimeout)

      if (e.data.match(/^[0-9]{4}-[A-Za-z]{3}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}/)) {
        streamClientMessage(data.trim())
        data = ''
      }

      data += `\n` + e.data

      flushTimeout = setTimeout(() => {
        if (data.trim() !== '') {
          streamClientMessage(data.trim())
          // log('____FLUSH___', data)
          data = ''
        }
      }, 500)
    }
  }  
}

startStreamClient()

setInterval(() => {
  if (!upstreamConnected) {
    startStreamClient()
  }
}, 10000)

const PORT = process.env?.PORT || 8080
const app = express()
var expressWs = require('express-ws')(app)

log.log = console.log.bind(console)

app.use(bodyParser.json())
app.use(helmet())
app.use(express.static(__dirname + '/public'))
app.use(morganDebug('stream:httplog', 'combined'))

app.use(cors({
  origin: (process.env?.CORS_ORIGINS || '*').replace(/ +/g, ',').split(','),
  // methods: 'GET, POST, OPTIONS'
}))

// WebSocket endpoint for all batch transactions
app.ws('/batch', (ws, req) => {
  try {
    log('WebSocket connection for all batch transactions')
  
    Object.assign(ws, {
      subscriptionType: 'batch',
      hash: null, // null means listen to all batches
      messages: 0
    })

    ws.on('message', () => {
      ws.send('batch_all')
    })

  } catch (e) {
    ws.send(JSON.stringify({
      msg: e.message,
      error: true
    }))

    log(e.message)

    process.nextTick(() => {
      ws.close(4000, e.message)
    })
  }
})

// WebSocket endpoint for specific batch hash
app.ws('/batch/:hash([A-F0-9]{64})', (ws, req) => {
  try {
    const batchHash = (req.params?.hash || '').trim().toUpperCase()

    if (!batchHash.match(/^[A-F0-9]{64}$/)) {
      throw new Error('Invalid batch hash: ' + batchHash)
    }

    log('WebSocket connection for batch', batchHash)
  
    Object.assign(ws, {
      subscriptionType: 'batch',
      hash: batchHash,
      messages: 0
    })

    ws.on('message', () => {
      ws.send(batchHash)
    })

  } catch (e) {
    ws.send(JSON.stringify({
      msg: e.message,
      error: true
    }))

    log(e.message)

    process.nextTick(() => {
      ws.close(4000, e.message)
    })
  }
})

// WebSocket endpoint for XRPL account addresses
app.ws('/:account(r[a-zA-Z0-9]{20,})', (ws, req) => {
  try {
    const account = (req.params?.account || '').trim()

    if (!addressCodec.isValidClassicAddress(account)) {
      throw new Error('Invalid XRPL account address: ' + account)
    }

    log('WebSocket connection', account)
  
    Object.assign(ws, {
      subscriptionType: 'account',
      account,
      messages: 0
    })

    ws.on('message', () => {
      ws.send(account)
    })

  } catch (e) {
    ws.send(JSON.stringify({
      msg: e.message,
      error: true
    }))

    log(e.message)

    process.nextTick(() => {
      ws.close(4000, e.message)
    })
  }
})

// WebSocket endpoint for all contract transactions
app.ws('/contract', (ws, req) => {
  try {
    log('WebSocket connection for all contract transactions')
  
    Object.assign(ws, {
      subscriptionType: 'contract',
      hash: null, // null means listen to all contracts
      messages: 0
    })

    ws.on('message', () => {
      ws.send('contract_all')
    })

  } catch (e) {
    ws.send(JSON.stringify({
      msg: e.message,
      error: true
    }))

    log(e.message)

    process.nextTick(() => {
      ws.close(4000, e.message)
    })
  }
})

// WebSocket endpoint for specific contract hash
app.ws('/contract/:hash([A-F0-9]{64})', (ws, req) => {
  try {
    const contractHash = (req.params?.hash || '').trim().toUpperCase()

    if (!contractHash.match(/^[A-F0-9]{64}$/)) {
      throw new Error('Invalid contract hash: ' + contractHash)
    }

    log('WebSocket connection for contract', contractHash)
  
    Object.assign(ws, {
      subscriptionType: 'contract',
      hash: contractHash,
      messages: 0
    })

    ws.on('message', () => {
      ws.send(contractHash)
    })

  } catch (e) {
    ws.send(JSON.stringify({
      msg: e.message,
      error: true
    }))

    log(e.message)

    process.nextTick(() => {
      ws.close(4000, e.message)
    })
  }
})

app.get('/', async (req, res) => {
  res.status(404).json({
    msg: 'Connect using a WebSocket client to /batch, /contract, or /{account} for all transactions, or /batch/{hash}, /contract/{hash}, or /{account} for specific items',
    error: true
  })
})

app.get('/recent/batches', async (req, res) => {
  return res.json({
    batches: (await redis.keys('batch:*')).map(k => k.slice(6))
  })
})

app.get('/recent/contracts', async (req, res) => {
  return res.json({
    contracts: (await redis.keys('contract:*')).map(k => k.slice(9))
  })
})

app.get('/recent/accounts', async (req, res) => {
  return res.json({
    accounts: (await redis.keys('account:*')).map(k => k.slice(8))
  })
})

app.get('/recent/batch/:hash([A-F0-9]{64})', async (req, res) => {
  const batchHash = req.params.hash.toUpperCase()
  const logs = (await Promise.all((await redis.keys('msg:batch:' + batchHash + '_*'))
    .map(async l => {
      const m = l.slice(10).split('_')
      return {
        timestamp: m[1],
        data: await redis.get(l)
      }
    }))).reduce((a, b) => {
      a[b.timestamp] = b.data
      return a
    }, {})

  return res.json({
    batch: batchHash,
    messages: Number(await redis.get('batch:' + batchHash) || 0),
    logs: Object.keys(logs).sort().reduce((a, b) => {
      a[b] = logs[b]
      return a
    }, {})
  })
})

app.get('/recent/contract/:hash([A-F0-9]{64})', async (req, res) => {
  const contractHash = req.params.hash.toUpperCase()
  const logs = (await Promise.all((await redis.keys('msg:contract:' + contractHash + '_*'))
    .map(async l => {
      const m = l.slice(13).split('_')
      return {
        timestamp: m[1],
        data: await redis.get(l)
      }
    }))).reduce((a, b) => {
      a[b.timestamp] = b.data
      return a
    }, {})

  return res.json({
    contract: contractHash,
    messages: Number(await redis.get('contract:' + contractHash) || 0),
    logs: Object.keys(logs).sort().reduce((a, b) => {
      a[b] = logs[b]
      return a
    }, {})
  })
})

app.get('/recent/:account(r[a-zA-Z0-9]{18,})', async (req, res) => {
  const account = req.params.account
  const logs = (await Promise.all((await redis.keys('msg:account:' + account + '_*'))
    .map(async l => {
      const m = l.slice(12).split('_')
      return {
        timestamp: m[1],
        data: await redis.get(l)
      }
    }))).reduce((a, b) => {
      a[b.timestamp] = b.data
      return a
    }, {})

  return res.json({
    account: account,
    messages: Number(await redis.get('account:' + account) || 0),
    logs: Object.keys(logs).sort().reduce((a, b) => {
      a[b] = logs[b]
      return a
    }, {})
  })
})

app.get('/status', async (req, res) => {
  res.json({
    upstreamMessages: upstreamMessageCount,
    upstreamConnections: upstreamConnectCount,
    connections: expressWs.getWss().clients.size,
    subscriptions: [ ...expressWs.getWss().clients.values() ].map(c => {
      return {
        type: c?.subscriptionType,
        hash: c?.hash || 'all',
        messages: c?.messages || 0
      }
    }).reduce((a, b) => {
      const key = b.type + '_' + b.hash
      Object.assign(a, {
        [key]: {
          messages: (a[key]?.messages || 0) + b.messages,
          connections: (a[key]?.connections || 0) + 1
        }
      })
      return a
    }, {})
  })
})

app.get('/batch', 
  (req, res, next) => {
    req.url = '/'
    next()
  },
  express.static(__dirname + '/public', { index: 'client.html' }))

app.get('/batch/:hash([A-F0-9]{64})', 
  (req, res, next) => {
    req.url = '/'
    next()
  },
  express.static(__dirname + '/public', { index: 'client.html' }))

app.get('/contract', 
  (req, res, next) => {
    req.url = '/'
    next()
  },
  express.static(__dirname + '/public', { index: 'client.html' }))

app.get('/contract/:hash([A-F0-9]{64})', 
  (req, res, next) => {
    req.url = '/'
    next()
  },
  express.static(__dirname + '/public', { index: 'client.html' }))

app.get('/:account(r[a-zA-Z0-9]{20,})', 
  (req, res, next) => {
    req.url = '/'
    if (!addressCodec.isValidClassicAddress(req.params?.account || '')) {
      next('route')
    } else {
      next()
    }
  },
  express.static(__dirname + '/public', { index: 'client.html' }))

app.get('*', async (req, res) => {
  res.status(404).json({
    msg: 'Not found',
    error: true
  })
})

app.listen(PORT, () => {
  require('dns').lookup(require('os').hostname(), async (err, adr, fam) => {
    log(`\nApp listening at http://${adr}:${PORT}`)
    log(`                 http://localhost:${PORT}`)
  })
})