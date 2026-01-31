// var account = document.location.pathname.replace(/^[^a-zA-Z0-9]+/g, '').split('/')[0]
var account = document.location.pathname.replace(/^[^a-zA-Z0-9]+/g, '').split('/')[0].replace(/^debugstream/, '')
var endpoint = 'ws' + document.location.origin.slice(4) + '/' + account
var reconnect = 1
var reconnectTimer

document.getElementById('account').innerText = account
console.log('Debug Stream WebSocket', { account, endpoint })

document.getElementById('connected').style.display = 'none'

var stopped = false
var socket
var msgid
var messages = []

function reveal (messageid) {
  var el = document.getElementById('msg_' + messageid)
  el.innerHTML = ''
  var message = {
    data: messages[messageid - 1].replace(new RegExp('(' + account + ')', 'g') , '<u class="fw-bold text-primary">$1</u>')
  }

  if (message.data.match(/^[0-9]{4}-[a-z]{3}-[0-9]{2} /i)) {
    el.innerHTML += '<small class="text-muted">' + message.data.slice(0, 34) + '</small> ' + message.data.slice(34)
  } else {
    el.innerHTML += message.data
  }
}

function connection () {
  if (stopped) return
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
    console.log('Open!', account)
  } 
  
  socket.onclose = function () {
    document.getElementById('connected').style.display = 'none'
    document.getElementById('connecting').style.display = 'block'  
  
    if (reconnect > 10) {
      reconnect = 10
    }
    console.log('Close!', account, 'try to reconnect in', reconnect, 'sec')
    reconnectTimer = setTimeout(function () {
      window.dispatchEvent(new Event('reconnectws'))
    }, reconnect * 1000)
  }

  socket.onmessage = function (message) {
    if (message.data.trim() === account.trim()) {
      return
    }

    document.getElementById('connected').style.display = 'none'
    document.getElementById('connecting').style.display = 'none'

    console.log(account, message)
    try {
      var json = JSON.parse(message.data)
      if (json.error) {
        stopped = true
        console.log('Stopped, error', json)
        socket.close()
      }
    } catch (e) {}

    msgid = messages.push(message.data)

    var el = document.createElement('pre')
    el.setAttribute('id', 'msg_' + msgid)
    el.style.fontSize = '.8em'
    el.style.whiteSpace = 'pre-wrap'

    el.innerHTML = ''
    var remaningMessage = message.data
    if (remaningMessage.match(/^[0-9]{4}-[a-z]{3}-[0-9]{2} /i)) {
      el.innerHTML += '<small class="text-muted">' + remaningMessage.slice(0, 34) + '</small> '
      remaningMessage = message.data.slice(34)
    }

    if (remaningMessage.length > 350 || remaningMessage.split("\n").length > 5) {
      var trunc
      if (remaningMessage.split("\n").length > 6) {
        trunc = remaningMessage.split("\n").slice(0, 6).join("\n")
      } else {
        trunc = remaningMessage.slice(0, 350)
      }

      el.innerHTML += trunc.replace(new RegExp('(' + account + ')', 'g') , '<u class="fw-bold text-primary">$1</u>') + '<br />'
      var elb = document.createElement('button')
      elb.innerHTML = '... (Read more)'
      elb.setAttribute('msgid', msgid)
      elb.setAttribute('class', 'py-0 px-2 btn btn-primary btn-sm float-end pull-end')
      elb.onclick = function () {
        reveal(elb.getAttribute('msgid'))
      }
      el.appendChild(elb)
    } else {
      el.innerHTML += remaningMessage.replace(new RegExp('(' + account + ')', 'g') , '<u class="fw-bold text-primary">$1</u>')
    }

    el.setAttribute('class', 'list-item text-dark py-1 border border-light shadow-sm mb-3 px-2 rounded ')
    document.getElementById('list').appendChild(el)
  }  
}

window.addEventListener('reconnectws', connection)

connection()
