const vfs = require('vinyl-fs');
const babel = require('gulp-babel');

vfs.src('src/tasks/**/*.js')
  .pipe(babel())
  .pipe(vfs.dest('./tasks'));