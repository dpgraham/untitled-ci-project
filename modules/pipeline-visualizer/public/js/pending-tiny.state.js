window.MOCK_STATE = {
  'jobs': [
    {
      'name': 'dependencies',
      'steps': [
        {
          'command': 'echo "//npm.pkg.github.com/:_authToken=$GH_NPM_TOKEN" > ~/.npmrc'
        },
        {
          'command': 'echo "@dpgraham:registry=https://npm.pkg.github.com" >> ~/.npmrc'
        },
        {
          'command': 'npm ci --loglevel verbose'
        }
      ],
      'onFilesChanged': 'package*.json',
      'status': 'pending'
    },
    {
      'name': 'lint',
      'steps': [
        {
          'command': 'npm run lint'
        }
      ],
      'onFilesChanged': null,
      'status': 'pending',
      'group': 'tests',
      'logfilePath': 'mock-logfile.log'
    },
    {
      'name': 'unit-test',
      'steps': [
        {
          'command': 'apk add --no-cache curl'
        },
        {
          'command': 'curl -fsSL https://deb.nodesource.com/setup_18.x | sh'
        },
        {
          'command': 'apk add --no-cache nodejs npm'
        },
        {
          'command': 'echo "installed node"'
        },
        {
          'command': 'node --version'
        },
        {
          'command': 'cd /ci'
        },
        {
          'command': 'npm run test'
        }
      ],
      'onFilesChanged': null,
      'status': 'pending',
      'image': 'docker:dind',
      'env': {
        'DOCKER_VERSION': ''
      },
      'copy': [
        {
          'src': '/ci'
        }
      ],
      'group': 'tests',
      'artifactsDir': '/ci/coverage'
    }
  ],
  'image': 'node:22',
  'files': './',
  'ignorePatterns': [
    'node_modules/**/*',
    '**/node_modules/**/*',
    '.git/**/*',
    'output-ci/'
  ],
  'result': 'in progress',
  'maxConcurrency': 3,
  'outputDir': 'output-ci/',
  'workDir': '/ci/',
  'pipelineFile': 'C:\\Users\\dpgra\\code\\untitled-ci-project\\node.pipeline.js',
  'env': {
    'GH_NPM_TOKEN': 'ghp_FR9PB**************',
    'DOCKER_USERNAME': 'dpgraham',
    'GHCR_PASSWORD': '$GH_NPM_TOKEN',
    'DOCKER_PASSWORD': '$DOCKER_PASSWORD'
  },
  'secrets': {
    'GH_NPM_TOKEN': 'ghp_FR9PB**************',
    'DOCKER_USERNAME': 'dpgraham',
    'GHCR_PASSWORD': '$GH_NPM_TOKEN',
    'DOCKER_PASSWORD': '$DOCKER_PASSWORD'
  },
  'isInvalidPipeline': false,
  'invalidReason': null,
  'exitOnDone': false
};