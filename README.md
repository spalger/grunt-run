# grunt-run

> Invite external commands into your grunt process with three tasks `run`, `wait` and `stop`.

## Getting Started
This plugin requires Grunt `~0.4.1`

If you haven't used [Grunt](http://gruntjs.com/) before, be sure to check out the [Getting Started](http://gruntjs.com/getting-started) guide, as it explains how to create a [Gruntfile](http://gruntjs.com/sample-gruntfile) as well as install and use Grunt plugins. Once you're familiar with that process, you may install this plugin with this command:

```shell
npm install grunt-run --save-dev
```

Once the plugin has been installed, it may be enabled inside your Gruntfile with this line of JavaScript:

```js
grunt.loadNpmTasks('grunt-run');
```

## The "run" task

### Overview
In your project's Gruntfile, add a section named `run` to the data object passed into `grunt.initConfig()`.

```js
grunt.initConfig({
  run: {
    options: {
      // Task-specific options go here.
    },
    your_target: {
      cmd: 'executable',
      args: [
        'arg1',
        'arg2'
      ]
    }
  }
})
```

### Src/files/etc

Since this task doesn't operate on "files" it also doesn't use the standard src/files options. Instead, specify a `cmd` and `args` key to your test's config (see examples). `cmd` defaults to `"node"`.


### Options

#### options.wait
Type: `Boolean`
Default value: `true`

Should this task wait until the script exits before finishing?

#### options.ready
Type: `RegExp`, `Number`, or `false`
Default value: 1000

If we are **not** waiting for the process to complete, then how do we know the process is ready?

A RegExp will test the lines from stdout and complete the task once the test succeeds, a Number will just set a timeout, and anything else will complete the task on nextTick

#### options.failOnError
Type: `Boolean`
Default value: `false`

If the process outputs anything on stderr then the process will be killed. If wait is `true` it will cause the task to fail as well.

### Usage Examples

#### Default
Want to just run some command line tool? With this config calling `grunt run:tool` will run that tool.

```js
grunt.initConfig({
  run: {
    tool: {
      cmd: 'some-bash-script',
    }
  }
});

grunt.loadNpmTasks('grunt-run');
```

#### `wait`ing
In this example, we are starting a small server that will serve our mocha tests to a browser. We will then open that page in the browser and tell grunt to wait until the process is exited, which probably won't happen so the process will just run until the user ends the process manually.

```js
grunt.initConfig({
  run: {
    integration_server: {
      options: {
        wait: false
      },
      // cmd: "node", // but that's the default
      args: [
        'test/integration_server.js'
      ]
    }
  },
  // https://github.com/jsoverson/grunt-open
  open: {
    integration_suite: {
      path: 'http://localhost:8888',
      app: 'Google Chrome'
    }

  }
});

grunt.loadNpmTasks('grunt-run');
grunt.loadNpmTasks('grunt-open');

grunt.registerTask('test', [
  'run:integration_server',
  'open:integration_tests',
  'wait:integration_server'
]);
```

#### `stop`ing
We can do something similar using grunt-mocha to run the tests inside phantomjs, but instead of waiting for the process we will just stop it once mocha is done.

```js
grunt.initConfig({
  run: {
    integration_server: {
      options: {
        wait: false
      },
      args: [
        'test/integration_server.js'
      ]
    }
  },
  // https://github.com/kmiyashiro/grunt-mocha
  mocha: {
    integration_suite: {
      urls: 'http://localhost:8888',
      app: 'Google Chrome'
    }
  }
});

grunt.loadNpmTasks('grunt-run');
grunt.loadNpmTasks('grunt-mocha');

grunt.registerTask('test', [
  'run:integration_server',
  'mocha:integration_suite',
  'stop:integration_server'
]);
```

## Contributing
Please lint and test your code with the included jshint config, or just run `grunt`.
