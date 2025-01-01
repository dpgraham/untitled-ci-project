# DESIGN OF UNTITLED CI PROJECT

## EXAMPLE OF A BASIC PIPELINE

```
// node.pipeline.js
image('node:20-alpine')

job('install dependencies') {
  files('package-*.json')
  step('run npm ci')
}

job('run tests') {
  files('test/**')
  step('run npm test')
  step('run npm run lint')
}

job('build') {
  files('src/**')
  step('run npm run build')
}

stage('E2E tests') {
  job('test #1') {
    step('run npm run test:e2e')
  }

  job('test #2') {
    step('run npm run test:e2e')
  }

  job('test #3') {
    step('run npm run test:e2e')
  }
}
```

Run this pipeline with

`pipeline run node.pipeline.js`

with args

```
--
```
