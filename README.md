# Sticky session, but you choose what sticks

> this module is a fork of a [pull request][4] that attempted to solve the reverse proxy issue, but given that no one maintains it anymore (last commit was more than half a decade ago), package uses a deprecated API, and a needed feature of asynchronous worker shutdown and custom sticky logic, it was best to create a separate package altogether.

A simple flexible way to load balance your session-based or [socket.io][0] apps with a [cluster][1].

## Installation

```bash
npm install sticky-session-custom
```

## Usage

##### Balancing based on direct IP connection #####

This is the fastest since the load balancer doesn't need to parse any HTTP headers.

```javascript
var cluster = require('cluster'); // Only required if you want the worker id
var sticky = require('sticky-session-custom');

var server = require('http').createServer(function(req, res) {
  res.end('worker: ' + cluster.worker.id);
});

if (sticky.listen(server, 3000)) {
  // Master code
  server.once('listening', function() {
    console.log('server started on 3000 port');
  });
} else {
  // Worker code
}
```


##### Balancing based on a header like `x-forwarded-for` #####

For running behind a reverse proxy that uses a header for sending over the client IP, specify that header using `proxyHeader`.

**Note that this approach is a bit slower as it needs to first parse the request headers.**

```javascript
var cluster = require('cluster'); // Only required if you want the worker id
var sticky = require('sticky-session-custom');

var server = require('http').createServer(function(req, res) {
  res.end('worker: ' + cluster.worker.id);
});

var closeMaster = sticky.listen(server, 3000, {
  workers: 8,
  proxyHeader: 'x-forwarded-for' // header to read for IP
});

if (closeMaster) {
  // Master code
  server.once('listening', function() {
    console.log('server started on 3000 port');
  });
} else {
  // Worker code
}
```


##### Custom Balancing Logic #####

If you want more control over what sticks, you can specify a custom function that generates an array of numbers to be hashed, which determines the worker to forward to. Below is an example of forwarding authenticated requests to the same worker.

**Note that this approach is a bit slower as it needs to first parse the request headers, (but if you don't need those, use generatePrehashArrayNoParsing instead)**

```javascript
var cluster = require('cluster'); // Only required if you want the worker id
var sticky = require('sticky-session-custom');

var server = require('http').createServer(function(req, res) {
  res.end('worker: ' + cluster.worker.id);
});

var closeMaster = sticky.listen(server, 3000, {
  workers: 8,
  generatePrehashArray(req, socket) {
    var parsed = new URL(req.url, 'https://dummyurl.example.com');
    // you can use '' instead of Math.random() if you want to use a consistent worker
    // for all unauthenticated requests
    var userToken = parsed.searchParams.get('token') || Math.random().toString();
    // turn string into an array of numbers for hashing
    return userToken.split('').filter(e => !!e).map(e => e.charCodeAt());
  }
});

if (closeMaster) {
  // Master code
  server.once('listening', function() {
    console.log('server started on 3000 port');
  });
} else {
  // Worker code
}
```


##### Shutting down gracefully #####

If there is no listener for SIGINT in the worker, it calls `process.exit()` directly. Otherwise, it does `process.emit('SIGINT')` and lets the listener shut it down. For this module, it is best to be used in conjunction with `async-exit-hook`. 

```javascript
var cluster = require('cluster'); // Only required if you want the worker id
var sticky = require('sticky-session-custom');
var exitHook = require('async-exit-hook');

var server = require('http').createServer(function(req, res) {
  res.end('worker: ' + cluster.worker.id);
});

var closeMaster = sticky.listen(server, 3000);

if (closeMaster) {
  // Master code
  server.once('listening', function() {
    console.log('server started on 3000 port');
    setTimeout(function () {
      closeMaster(function () {
        console.log('Closed master!');
      }, false); // set to true if you want to wait for connections to close
    }, 2000);
  });
} else {
  // Worker code

  exitHook(function(done) {
    console.log('Worker received exit signal. Shutting down...');
    setTimeout(function() {
      console.log('shutdown');
      done();
    }, 3000);
  });
  
  // you can also send a shutdown signal to the master like this.
  // set to true if you want to wait for connections to close before
  // shutting down workers
  // process.send(['sticky:masterclose', false]);
}
```


## Reason for sticky sessions (for socket.io)

Socket.io is doing multiple requests to perform handshake and establish
connection with a client. With a `cluster` those requests may arrive to
different workers, which will break handshake protocol.

Sticky-sessions module is balancing requests using their IP address. Thus
client will always connect to same worker server, and socket.io will work as
expected, but on multiple processes!

#### Note about `node` version

`sticky-session` requires `node` to be at least `0.12.0` because it relies on
`net.createServer`'s [`pauseOnConnect` flag][2].

A deeper, step-by-step explanation on how this works can be found in
[`elad/node-cluster-socket.io`][3]

#### LICENSE

This software is licensed under the MIT License.

Copyright Fedor Indutny, 2015.

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
USE OR OTHER DEALINGS IN THE SOFTWARE.

[0]: http://socket.io/
[1]: http://nodejs.org/docs/latest/api/cluster.html
[2]: https://nodejs.org/api/net.html#net_net_createserver_options_connectionlistener
[3]: https://github.com/elad/node-cluster-socket.io
[4]: https://github.com/indutny/sticky-session/pull/45
