/*
 * grunt-run
 * https://github.com/spenceralger/grunt-run
 *
 * Copyright (c) 2013 Spencer Alger
 * Licensed under the MIT license.
 */
module.exports = makeTask;
function makeTask(grunt) {
  const stripAnsi = require('strip-ansi');
  const childProcess = require('child_process');

  const shouldEscapeRE = / |"|'|\$|&|\\/;
  const dangerArgsRE = /"|\$|\\/g;
  const runningProcs = [];

  process.on('exit', () => kill(runningProcs));

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

  function kill(procs) {
    for (const proc of procs) {
      proc.kill();
    }
  }

  function getProcs(pid) {
    return runningProcs.filter(proc => proc.pid === pid);
  }

  function remove(array, item) {
    do {
      const i = array.indexOf(item);
      if (i === -1) {
        return;
      }

      array.splice(i, 1);
    } while(true);
  }

  function includes(array, target) {
    for (const item of array) {
      if (item === target) {
        return true;
      }
    }

    return false;
  }

  grunt.task.registerMultiTask('run', 'used to start external processes (like servers)', function (keepalive) {
    const name = this.target;
    let cmd = this.data.cmd || 'node';
    let args = this.data.args || [];
    const additionalArgs = [];
    const opts = this.options({
      wait: true,
      failOnError: false,
      quite: false,
      ready: 1000,
      cwd: process.cwd(),
      passArgs: [],
      itterable: false,
      readyBufferLength: 1024
    });

    if (keepalive === 'keepalive') {
      // override the wait setting
      opts.wait = true;
    }

    const spawnOpts = {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    };

    if (opts.env) {
      spawnOpts.env = opts.env;
    }

    const pid = getPid(name);
    if (pid && getProcs(pid).length) {
      grunt.log.warn(name + ' is already running');
      return;
    }

    if (!opts.itterable && includes(process.argv, 'run')) {
      grunt.log.warn('Skipping run:' + this.target + ' since it not itterable. Call it directly or from another task.');
      return;
    }

    opts.passArgs.map(function (arg) {
      let val = grunt.option(arg);

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
        if(process.platform === 'win32') {
          args[2] += ' ' + additionalArgs.join(' ');
        } else {
          args[1] += ' ' + additionalArgs.join(' ');
        }
      }
    } else {
      args = args.concat(additionalArgs);
    }

    grunt.verbose.writeln('running', cmd, 'with args', args);
    const proc = childProcess.spawn(cmd, args, spawnOpts);
    savePid(name, proc.pid);

    const done = this.async();

    // handle stdout, stderr
    if (!opts.quiet) {
      proc.stdout.pipe(process.stdout);
      proc.stderr.pipe(process.stderr);

      proc.on('close', function () {
        proc.stdout.unpipe(process.stdout);
        proc.stderr.unpipe(process.stderr);
      });
    }

    // handle errors that prevent the proc from starting
    proc.on('error', function (err) {
      grunt.log.error(err);
    });

    if (opts.wait) {
      waitForProc();
    } else {
      trackBackgroundProc();

      if (opts.ready instanceof RegExp) {
        waitForReadyOutput();
      } else if (opts.ready) {
        waitForTimeout();
      } else {
        doNotWait();
      }
    }


    // ensure that the streams are draining if we aren't already draining them (like quiet=true)
    try {
      proc.stdout.resume();
      proc.stderr.resume();
    } catch(e) {
      //node versions > 0.8 start streams in flow mode so resume will throw an error
    }
    return;

    // we are waiting for the proc to close before moving on
    function waitForProc() {
      proc.on('close', function (exitCode) {
        done(exitCode && new Error('non-zero exit code ' + exitCode));
      });
    }

    // we aren't waiting for this proc to close, so setup some tracking stuff
    function trackBackgroundProc() {
      runningProcs.push(proc);
      proc.on('close', function () {
        remove(runningProcs, proc);
        clearPid(name);
        grunt.log.debug('Process ' + name + ' closed.');
      });
    }

    // we are scanning the output for a specific regular expression
    function waitForReadyOutput() {
      function onCloseBeforeReady(exitCode) {
        done(exitCode && new Error('non-zero exit code ' + exitCode));
      }

      let outputBuffer = '';

      function checkChunkForReady(chunk) {
        outputBuffer += chunk.toString('utf8');

        // ensure the buffer doesn't grow out of control
        if (outputBuffer.length >= opts.readyBufferLength) {
          outputBuffer = outputBuffer.slice(outputBuffer.length - opts.readyBufferLength);
        }

        // don't strip ansi until we check, incase an ansi marker is split across chuncks.
        if (!opts.ready.test(stripAnsi(outputBuffer))) return;

        outputBuffer = '';
        proc.removeListener('close', onCloseBeforeReady);
        proc.stdout.removeListener('data', checkChunkForReady);
        proc.stderr.removeListener('data', checkChunkForReady);
        done();
      }

      proc.on('close', onCloseBeforeReady);
      proc.stdout.on('data', checkChunkForReady);
      proc.stderr.on('data', checkChunkForReady);
    }

    function waitForTimeout() {
      setTimeout(function () {
        grunt.log.ok(name + ' started');
        done();
      }, opts.ready);
    }

    function doNotWait() {
      grunt.log.ok(name + ' started');
      done();
    }

  });

  grunt.task.registerMultiTask('stop', 'stop a process started with "run" ' +
    '(only works for tasks that use wait:false)', function () {

    const pid = this.data._pid;
    const name = this.target;
    const procs = getProcs(pid);
    clearPid(name);
    if (procs.length) {
      const done = this.async();
      let counter = procs.length;
      function closeHandler() {
        if (--counter === 0) {
          grunt.log.ok(name + ' stopped');
          done();
        }
      }
      procs.forEach(function (proc) {
        proc.once('close', closeHandler);
      });
      if(process.platform === 'win32') {
        childProcess.execSync(`taskkill /f /t /pid ${pid}`);
      } else {
        kill(procs);
      }
    } else {
      grunt.log.ok(name + ' already stopped');
    }
  });

  grunt.task.registerMultiTask('wait', 'wait for a process started with "run" to close ' +
    '(only works for tasks that use wait:false)', function () {

    const pid = this.data._pid;
    const proc = getProcs(pid)[0];
    if (proc) {
      proc.once('close', this.async());
    } else {
      grunt.log.writeln(this.target + ' (' + pid + ') is already stopped.');
    }
  });

}