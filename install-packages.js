/* eslint-disable */
// Import required modules
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Function to install packages
const installPackages = (dir) => {
  fs.readdir(dir, { withFileTypes: true }, (err, files) => {
    if (err) {
      console.error(`Error reading directory ${dir}:`, err);
      return;
    }

    files.forEach((file) => {
      const filePath = path.join(dir, file.name);

      // Check if the file is a directory and has a package.json
      if (file.isDirectory()) {
        const packageJsonPath = path.join(filePath, 'package.json');
        fs.access(packageJsonPath, fs.constants.F_OK, (err) => {
          if (!err) {
            // If package.json is found, run npm install
            console.log(`Installing packages in ${filePath}...`);
            exec('npm install', { cwd: filePath }, (error, stdout, stderr) => {
              if (error) {
                console.error(`Error installing packages in ${filePath}:`, error);
                return;
              }
              console.log(stdout);
              if (stderr) {
                console.error(stderr);
              }
            });
          }
        });
      }
    });
  });
};

// Start the installation process in the ./modules directory
const modulesDir = path.join(__dirname, 'modules');
installPackages(modulesDir);