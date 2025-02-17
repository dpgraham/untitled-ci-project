# TASKS

TODO: add a dev script in the root that keeps the services running
TODO: make a test job page
TODO: make this project runnable in Gitpod


# BUGS

TODO: 0 reproduction steps for sequencing bug
  * run node.pipeline.js
  * wait for lint to finish
  * save "main.js" after lint finished but before unit test finished
  * unit test will still keep running and finish with a failure despite being invalidated
TODO: 0... sometimes jobs get stuck in "running" state despite being finished. no repro     steps found yet
TODO: 0... pipelines, once passed, are stuck on 'passed' even after invalidating jobs