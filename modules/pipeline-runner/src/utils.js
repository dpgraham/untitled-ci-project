const fs = require('fs');
const glob = require('glob');
const path = require('path');
const picomatch = require('picomatch');
const slash = require('slash');

function getFiles (files, rootDir, ignorePatterns) {
  let filesArr;
  try {
    if (fs.statSync(path.join(rootDir, files)).isDirectory()) {
      // If 'files' is a directory, read all files recursively
      filesArr = readFilesRecursively(path.join(rootDir, files), rootDir);
    }
  } catch (e) {}

  if (!filesArr) {
    // If 'files' is a glob pattern, use glob.sync
    filesArr = glob.sync(files, { cwd: rootDir, dot: true });
  }

  filesArr = filesArr.filter((filePath) => {
    for (const ignorePattern of ignorePatterns) {
      if (picomatch(ignorePattern, { dot: true })(filePath) ||
          slash(filePath).startsWith(slash(ignorePattern))) {
        return false;
      }
    }
    return true;
  });

  return filesArr;
}

function readFilesRecursively (dir, rootDir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      // Recursively read files in subdirectories
      results = results.concat(readFilesRecursively(file, rootDir));
    } else {
      // Return relative path instead of absolute path
      results.push(path.relative(rootDir, file));
    }
  });
  return results;
}

module.exports = { getFiles };