// Copyright 2012 Mark Cavage.  All rights reserved.

var async = require('async');
var log4js = require('log4js');
var test = require('tap').test;
var uuid = require('node-uuid');
var ZooKeeper = require('zookeeper');

var elect = require('../lib').elect;



/// --- Globals

var leader;
var slaves = [];
var zk;

var NUM_SLAVES = 5;
var OPTS = {
	zookeeper: 'localhost:2181',
	log4js: log4js,
	znode: '/' + uuid()
};



/// --- Tests

test('setup', function(t) {
	zk = new ZooKeeper({
		connect: 'localhost:2181',
		timeout: 1000,
		debug_level: ZooKeeper.ZOO_LOG_LEVEL_WARN,
		host_order_deterministic: false
	});

	async.waterfall([
		function connect(callback) {
			return zk.connect(function(err) {
				return callback(err, '');
			});
		},
		function create(parent, callback) {
			var node = OPTS.znode;
			return zk.a_create(node, null, 0, function(rc, msg) {
				if (rc != 0)
					return callback(new Error(msg));

				return callback(null, node);
			});
		}
	], function done(err) {
		if (err)
			t.bailout(err.stack);

		t.end();
	});
});


test('create leader', function(t) {
	return elect(OPTS, function(err, node) {
		t.ifError(err);
		t.ok(node);
		t.ok(node.leader);
		t.equal(node.zroot, OPTS.znode);
		t.ok(node.znode);
		leader = node;
		t.end();
	});
});


test('create slaves', function(t) {
	var finished = 0;
	function callback(err, node) {
		t.ifError(err);
		t.ok(node);
		t.notOk(node.leader);
		t.equal(node.zroot, OPTS.znode);
		t.ok(node.znode);
		slaves.push(node);

		if (++finished === NUM_SLAVES) {
			// Further tests set up events on immediate parent
			// child, so make sure this is all sorted for that to
			// work
			slaves.sort(function(a, b) {
				return a.znode.localeCompare(b.znode);
			});
			t.end();
		}
	}

	for (var i = 0; i < NUM_SLAVES; i++)
		elect(OPTS, callback);

});


test('kill a slave', function(t) {
	slaves[3].once('watch', function(parent) {
		t.notOk(slaves[3].leader);
		t.equal(slaves[3].watching, slaves[1].znode);
		slaves.splice(2, 1);
		t.end();
	});
	slaves[3].once('leader', function() {
		t.bailout('Somehow we got made the leader');
	});
	slaves[3].once('error', function() {
		t.bailout(err.stack);
	});

	slaves[2].close(function() {
	});
});


test('new leader', function(t) {
	slaves[0].once('leader', function(parent) {
		t.end();
	});
	slaves[0].once('error', function() {
		t.bailout(err.stack);
	});

	leader.close(function() {});
});


test('teardown', function(t) {
	var finished = 0;

	function callback() {
		if (++finished < slaves.length)
			return false;

		return zk.a_delete_(OPTS.znode, 0, function(rc, msg) {
			zk.on('close', function(){
				t.end();
			});
			zk.close();
		});
	}

	slaves.forEach(function(s) {
		s.close(callback);
	});
});
