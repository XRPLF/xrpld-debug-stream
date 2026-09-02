var batchHash = null
var endpoint = null
var reconnect = 1
var reconnectTimer

document.getElementById('batch-info').innerText = 'All Batch Transactions'
console.log('Debug Stream WebSocket for Batch Transactions')

document.getElementById('connected').style.display = 'none'

var stopped = false
var socket
var msgid = 0
var messages = []
var messageCount = 0

function updateBatchInfo() {
  const batchInfoEl = document.getElementById('batch-info')
  if (batchHash) {
    batchInfoEl.innerText = `Batch: ${batchHash}`
  } else {
    batchInfoEl.innerText = 'All Batch Transactions'
  }
}

function reveal(messageid) {
  var el = document.getElementById('msg_' + messageid)
  el.innerHTML = ''
  var message = {
    data: messages[messageid - 1]
  }

  // Highlight batch hashes in the message
  var highlightedData = message.data.replace(/BatchTrace\[([A-F0-9]{64})\]/g, '<u class="fw-bold text-success">BatchTrace[$1]</u>')

  if (message.data.match(/^[0-9]{4}-[a-z]{3}-[0-9]{2} /i)) {
    el.innerHTML += '<small class="text-muted">' + highlightedData.slice(0, 34) + '</small> ' + highlightedData.slice(34)
  } else {
    el.innerHTML += highlightedData
  }
}

function connection() {
  if (stopped || !endpoint) return
  reconnect++

  try {
    socket.close()
  } catch (e) {}

  socket = new WebSocket(endpoint)

  setInterval(function () {
    try {
      if (socket.readyState === socket.OPEN) {
        socket.send('Ping')
      }
    } catch (e) {}
  }, 10000)

  var connectionTimeout = setTimeout(function () {
    console.log('Give up connecting')
    try {
      socket.close()
    } catch (e) {}
    socket.onclose()
  }, 3000)

  socket.onopen = function () {
    document.getElementById('connected').style.display = 'block'
    document.getElementById('connecting').style.display = 'none'
    
    reconnect = 1
    clearTimeout(connectionTimeout)
    clearTimeout(reconnectTimer)
    console.log('Connected to batch stream!', batchHash || 'all batches')
  } 
  
  socket.onclose = function () {
    document.getElementById('connected').style.display = 'none'
    document.getElementById('connecting').style.display = 'block'  
  
    if (reconnect > 10) {
      reconnect = 10
    }
    console.log('Disconnected from batch stream', batchHash || 'all batches', 'try to reconnect in', reconnect, 'sec')
    reconnectTimer = setTimeout(function () {
      window.dispatchEvent(new Event('reconnectws'))
    }, reconnect * 1000)
  }

  socket.onmessage = function (message) {
    // Skip ping responses
    if (message.data.trim() === 'batch_all' || (batchHash && message.data.trim() === batchHash)) {
      return
    }

    document.getElementById('connected').style.display = 'none'
    document.getElementById('connecting').style.display = 'none'

    console.log('Batch message received:', message)
    try {
      var json = JSON.parse(message.data)
      if (json.error) {
        stopped = true
        console.log('Stopped, error', json)
        socket.close()
        return
      }
    } catch (e) {}

    msgid = messages.push(message.data)
    messageCount++
    document.getElementById('message-count').innerText = messageCount

    var el = document.createElement('pre')
    el.setAttribute('id', 'msg_' + msgid)
    el.style.fontSize = '.8em'
    el.style.whiteSpace = 'pre-wrap'

    el.innerHTML = ''
    var remainingMessage = message.data
    if (remainingMessage.match(/^[0-9]{4}-[a-z]{3}-[0-9]{2} /i)) {
      el.innerHTML += '<small class="text-muted">' + remainingMessage.slice(0, 34) + '</small> '
      remainingMessage = message.data.slice(34)
    }

    if (remainingMessage.length > 350 || remainingMessage.split("\n").length > 5) {
      var trunc
      if (remainingMessage.split("\n").length > 6) {
        trunc = remainingMessage.split("\n").slice(0, 6).join("\n")
      } else {
        trunc = remainingMessage.slice(0, 350)
      }

      // Highlight batch hashes
      var highlightedTrunc = trunc.replace(/BatchTrace\[([A-F0-9]{64})\]/g, '<u class="fw-bold text-success">BatchTrace[$1]</u>')
      el.innerHTML += highlightedTrunc + '<br />'
      
      var elb = document.createElement('button')
      elb.innerHTML = '... (Read more)'
      elb.setAttribute('msgid', msgid)
      elb.setAttribute('class', 'py-0 px-2 btn btn-primary btn-sm float-end pull-end')
      elb.onclick = function () {
        reveal(elb.getAttribute('msgid'))
      }
      el.appendChild(elb)
    } else {
      // Highlight batch hashes
      var highlightedMessage = remainingMessage.replace(/BatchTrace\[([A-F0-9]{64})\]/g, '<u class="fw-bold text-success">BatchTrace[$1]</u>')
      el.innerHTML += highlightedMessage
    }

    el.setAttribute('class', 'list-item text-dark py-1 border border-light shadow-sm mb-3 px-2 rounded ')
    document.getElementById('list').appendChild(el)
    
    // Auto-scroll to bottom
    window.scrollTo(0, document.body.scrollHeight)
  }  
}

function connect() {
  const hashInput = document.getElementById('batch-hash').value.trim().toUpperCase()
  
  if (hashInput && !hashInput.match(/^[A-F0-9]{64}$/)) {
    alert('Invalid batch hash. Please enter a 64-character hexadecimal string or leave empty for all batches.')
    return
  }
  
  batchHash = hashInput || null

  const host = '79.110.60.105'
  
  if (batchHash) {
    endpoint = `ws://${host}:8081/account/${batchHash}`
  } else {
    endpoint = `ws://${host}:8081/contract`
  }
  
  updateBatchInfo()
  
  console.log('Connecting to batch stream:', { batchHash, endpoint })
  
  stopped = false
  connection()
}

function disconnect() {
  stopped = true
  try {
    socket.close()
  } catch (e) {}
  
  document.getElementById('connected').style.display = 'none'
  document.getElementById('connecting').style.display = 'none'
  document.getElementById('ready').style.display = 'block'
  document.getElementById('connect-btn').style.display = 'inline-block'
  document.getElementById('disconnect-btn').style.display = 'none'
  
  clearTimeout(reconnectTimer)
}

document.getElementById('connect-btn').onclick = connect
document.getElementById('disconnect-btn').onclick = disconnect

// Allow Enter key to connect
document.getElementById('batch-hash').addEventListener('keypress', function(e) {
  if (e.key === 'Enter') {
    connect()
  }
})

window.addEventListener('reconnectws', connection)

// Auto-focus on hash input
document.getElementById('batch-hash').focus()