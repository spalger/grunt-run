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

  var SHOULD_ESCAPE_RE = / |"|'|\$|&|\\/;
  var DANGER_ARGS_RE = /"|\$|\\/g;
  var PID_LOG_FILE = __dirname + '/pid.log';

  var runningProcs = [];
  var __localPidLog = '{}';

  if (!grunt.file.exists(PID_LOG_FILE)) {
    grunt.file.write(PID_LOG_FILE, '{}');
  }

  // when other globalProcs exist, we should be able to stop them
  _.forOwn(getPidLog(true), function (pid, name, log) {
    savePid(name, true, pid);
  });

  process.on('exit', function () {
    _.each(runningProcs, function (proc) {
      proc.kill();
    });
  });

  function getPidLog(global) {
    return JSON.parse(global ? grunt.file.read(PID_LOG_FILE) : __localPidLog);
  }

  function savePidLog(log, global) {
    if (global) {
      grunt.file.write(PID_LOG_FILE, JSON.stringify(log));
    } else {
      __localPidLog = JSON.stringify(log);
    }
  }

  function getPid(name, global) {
    return getPidLog(global)[name];
  }

  function savePid(name, global, pid) {
    var log = getPidLog(global);
    log[name] = pid;
    savePidLog(log, global);
  }

  function clearPid(name, global) {
    var log = getPidLog(global);
    delete log[name];
    savePidLog(log, global);
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
      global: true,
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

    if (getPid(name, opts.global)) {
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
        if (SHOULD_ESCAPE_RE.test(arg)) {
          val = '"' + arg.replace(DANGER_ARGS_RE, function (match) {
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
    savePid(name, opts.global, proc.pid);

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
      grunt.log.debug('Process ' + name + ' closed.');
    });

    if (opts.wait) {
      proc.on('close', function (exitCode) {
        clearPid(name, opts.global);
        proc.stderr.removeListener('data', onStderr);
        if (!opts.quiet) {
          proc.stdout.unpipe(process.stdout);
        }
        done(!exitCode);
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

  grunt.task.registerTask('stop', 'stop a process started with "run" ' +
    '(only works for tasks that use wait:false)', function (name) {

    // try local first, fallback to global
    var global = false;
    var pid = getPid(name, global);
    if (!pid) {
      global = true;
      pid = getPid(name, global);
    }

    if (!pid) {
      grunt.log.error('Unable to find a pid for process named ' + name);
      return;
    }

    try {
      process.kill(pid);
      clearPid(name, true);
    } catch (e) {
      grunt.log.warn(this.target + ' (' + pid + ') is already stopped.');
      grunt.verbose.error(e);
    }
  });

  grunt.task.registerTask('wait', 'wait for a process started with "run" to close ' +
    '(only works for tasks that use wait:false and global:false)', function (name) {

    var pid = getPid(name, false);

    if (!pid) {
      grunt.log.error('unable to find a process with the name ' + name);
      return;
    }

    var proc = _.find(runningProcs, { pid: pid });

    if (proc) {
      proc.once('close', this.async());
    } else {
      grunt.log.writeln(this.target + ' (' + pid + ') is already stopped.');
    }
  });

}
