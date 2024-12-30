const fs = require('fs');
const glob = require('glob');
const path = require('path');

function getFiles(files, rootDir) {
    let filesArr;
    try {
    if (fs.statSync(path.join(rootDir, files)).isDirectory()) {
        // If 'files' is a directory, read all files recursively
        filesArr = fs.readdirSync(path.join(rootDir, files)).map(file => path.join(files, file));
        filesArr = filesArr.map((file) => path.resolve(rootDir, file));
    }
    } catch (e) {}
    
    if (!filesArr) {
        // If 'files' is a glob pattern, use glob.sync
        filesArr = glob.sync(files, { cwd: rootDir, dot: true });
    }

    return filesArr;
}

module.exports = { getFiles };