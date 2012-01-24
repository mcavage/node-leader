node-leader is a micro library that implements the standard
[ZooKeeper](http://zookeeper.apache.org/)
[leader election algorithm](http://zookeeper.apache.org/doc/trunk/recipes.html#sc_leaderElection).

While functional, this is a little bit work-in-progress, as not all ZooKeeper
events/errors are handled, nor is error propagation to the client very "nice".

# Usage

    var assert = require('assert');
    var elect = require('leader').elect;
    var log4js = require('log4js');


    var opts = {
      zookeeper: 'localhost:2181',
      log4js: log4js,
      znode: '/my/service/election'
    };
    elect(opts, function(err, node) {
      assert.ifError(err);
      if (node.leader) {
        console.log('Hooray! I am the leader!');
      } else {
        node.on('leader', function() {
          console.log('I got elected as the leader!');
        });
      }
    });

# Installation

    $ npm install leader

# How does this work?

As mentioned above, this is a verbatim implementation of the ZooKeeper "recipe"
for doing
[leader election](http://zookeeper.apache.org/doc/trunk/recipes.html#sc_leaderElection).

If that's hard to parse, it looks like this in ZooKeeper.  All nodes in your
system use some path as the place to watch.  Everybody registers with a
ZooKeeper-generated sequential key, and the node with the lowest key wins.
Everyone that's not a leader registers to watch the _next_ node in the
ecosystem, and when that node gets deleted (which happens if the node
disconnects), then $self looks to see if they're the leader, and if not, sets
up a watch on the next node.  As an example, let's assume `/foo` is the place
in ZooKeeper we're talking about:


```
NodeA -> /foo/01
      ^
      |
    Watch (01)
      |
      |
NodeB -> /foo/02
      ^
      |
    Watch (02)
      |
      |
NodeC -> /foo/03
...
```

Now, let's say `NodeB` crashes.  `NodeC` will get a notification from ZooKeeper,
and go look for children of `/foo`. Upon seeing that `03` is not the lowest,
`NodeC` will not be the leader, but instead will register to watch `NodeA`:

```
NodeA -> /foo/01
      ^
      |
    Watch (01)
      |
      |
NodeC -> /foo/03
...
```

Now, if some time later, `NodeB` rejoins (because you know, someone in meatspace
got paged and brought it back up), it would likely get `04` and be watching
`NodeC`.  Lastly, if `NodeA` crashed, `NodeC` would get the `leader` event, and
you'd go do whatever it is you need to do to take over that responsibility.

## License

The MIT License (MIT)
Copyright (c) 2012 Mark Cavage

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Bugs

See <https://github.com/mcavage/node-leader/issues>.
