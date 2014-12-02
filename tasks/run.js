/*
 * grunt-run
 * https://github.com/spenceralger/grunt-run
 *
 * Copyright (c) 2013 Spencer Alger
 * Licensed under the MIT license.
 */
module.exports = makeTask;
function makeTask(grunt) {
  var _ = require('lodash');
  var util = require('util');
  var child_process = require('child_process');

  var shouldEscapeRE = / |"|'|\$|&|\\/;
  var dangerArgsRE = /"|\$|\\/g;
  var runningProcs = [];

  process.on('exit', function () {
    _.each(runningProcs, function (proc) {
      proc.kill();
    });
  });

  function getPid(name) {
    return grunt.config.get('stop.' + grunt.config.escape(name) + '._pid');
  }

  function savePid(name, pid) {
    grunt.config.set('stop.' + grunt.config.escape(name) + '._pid', pid);
    grunt.config.set('wait.' + grunt.config.escape(name) + '._pid', pid);
  }

  function clearPid(name) {
    grunt.config.set('stop.' + grunt.config.escape(name) + '._pid', null);
    grunt.config.set('wait.' + grunt.config.escape(name) + '._pid', null);
  }

  grunt.task.registerMultiTask('run', 'used to start external processes (like servers)', function (keepalive) {
    var self = this;
    var name = this.target;
    var cmd = this.data.cmd || 'node';
    var args = this.data.args || [];
    var additionalArgs = [];
    var opts = this.options({
      wait: true,
      failOnError: false,
      quite: false,
      ready: 1000,
      cwd: process.cwd(),
      passArgs: [],
      itterable: false
    });

    if (keepalive === 'keepalive') {
      // override the wait setting
      opts.wait = true;
    }

    var spawnOpts = {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    };

    if (opts.env) {
      spawnOpts.env = opts.env;
    }

    var pid = getPid(name);
    if (pid && _.find(runningProcs, { pid: pid })) {
      grunt.log.warn(name + ' is already running');
      return;
    }

    if (!opts.itterable && _.contains(process.argv, 'run')) {
      grunt.log.warn('Skipping run:' + this.target + ' since it not itterable. Call it directly or from another task.');
      return;
    }

    opts.passArgs.map(function (arg) {
      var val = grunt.option(arg);

      if (val !== void 0) {
        if (shouldEscapeRE.test(arg)) {
          val = '"' + arg.replace(dangerArgsRE, function (match) {
            return '\\' + match;
          }) + '"';
        }

        additionalArgs.push('--' + arg + '=' + val);
      }
    });

    if (this.data.exec) {
      // logic is from node's cp.exec method, adapted to benefit from
      // streaming io
      if (process.platform === 'win32') {
        cmd = 'cmd.exe';
        args = ['/s', '/c', '"' + this.data.exec + '"'];
        spawnOpts.windowsVerbatimArguments = true;
      } else {
        cmd = '/bin/sh';
        args = ['-c', this.data.exec];
      }

      if (additionalArgs.length) {
        args[1]+= ' ' + additionalArgs.join(' ');
      }
    } else {
      args = args.concat(additionalArgs);
    }

    grunt.verbose.writeln('running', cmd, 'with args', args);
    var proc = child_process.spawn(cmd, args, spawnOpts);
    savePid(name, proc.pid);

    var done = this.async();
    var timeoutId = null;

    // handle stdout
    if (opts.quiet) {
      proc.stdout.resume();
    } else {
      proc.stdout.pipe(process.stdout);
    }

    // handle stderr
    function onStderr(chunk) {
      if (opts.quiet !== Infinity) {
        process.stderr.write(chunk);
      }
      if (opts.failOnError) {
        proc.kill();
        done(new Error('Error output received'));
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      }
    }
    proc.stderr.on('data', onStderr);

    proc.on('error', function (err) {
      grunt.log.error(err);
    });

    proc.on('close', function () {
      var i;
      if ((i = runningProcs.indexOf(proc)) !== -1) {
        runningProcs.splice(i, 1);
      }
      clearPid(name);
      grunt.log.debug('Process ' + name + ' closed.');
    });

    if (opts.wait) {
      proc.on('close', function (exitCode) {
        clearPid(name);
        proc.stderr.removeListener('data', onStderr);
        if (!opts.quiet) {
          proc.stdout.unpipe(process.stdout);
        }
        done(exitCode && new Error('non-zero exit code ' + exitCode));
      });
    } else {
      grunt.log.ok(name + ' started');
      runningProcs.push(proc);
      if (opts.ready instanceof RegExp) {
        proc.stdout.on('data', function checkForReady(chunk) {
          if (opts.ready.test(chunk)) {
            proc.stdout.removeListener('data', checkForReady);
            done();
          }
        });
      } else if (opts.ready) {
        timeoutId = setTimeout(done, opts.ready);
      } else {
        process.nextTick(done);
      }
    }
  });

  grunt.task.registerMultiTask('stop', 'stop a process started with "run" ' +
    '(only works for tasks that use wait:false)', function () {

    var pid = this.data._pid;
    var name = this.target;
    var proc = _.find(runningProcs, { pid: pid });
    clearPid(name);
    if (proc) {
      proc.kill();
      grunt.log.ok(name + ' stopped');
    } else {
      grunt.log.ok(name + ' already stopped');
    }
  });

  grunt.task.registerMultiTask('wait', 'wait for a process started with "run" to close ' +
    '(only works for tasks that use wait:false)', function () {

    var pid = this.data._pid;
    var proc = _.find(runningProcs, { pid: pid });
    if (proc) {
      proc.once('close', this.async());
    } else {
      grunt.log.writeln(this.target + ' (' + pid + ') is already stopped.');
    }
  });

}
