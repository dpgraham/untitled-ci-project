<script>
  import { onMount } from 'svelte';
  import Card, { Content } from '@smui/card';
  import './global.scss';
  import { rateLimitedFunction } from './utils';
  import LinearProgress from '@smui/linear-progress';

  let state = $state({})
  let groups = $state([]);
  let jobLogs = $state([])
  let job = $state(null)
  let id;

  const MAX_LOG_LENGTH = 100 * 1024;

  let logLength = 0;

  // Get the query parameter "mockState"
  const urlParams = new URLSearchParams(window.location.search);
  const jobName = urlParams.get('job');
  const mockState = urlParams.get('mockState');  
  
  // Start an SSE session
  const eventSource = !mockState ? new EventSource('/events') : {};

  eventSource.onmessage = (event) => {
    const obj = JSON.parse(event.data);
    if (obj.message === 'state') {
      state = { ...obj.state };
      groups = groupJobs(state);
      if (jobName) {
        for (let checkJob of state?.jobs || []) {
          if (checkJob.name === jobName) {
            job = checkJob;
            break;
          }
        }
        // if ID is different, it means the job was restarted so 
        // clear the logs. Also clear logs if status changed to queued or pending
        const status = job.status;
        if (id !== job?.id || ['queued', 'pending'].includes(status)) {
          jobLogs = [];
          id = job.id;
        }
      }
    }
  };

  /**
   * group together jobs by there group name
   * @param state
   */
  function groupJobs (state) {
    let groups = [];
    let currGroup;
    for (const job of state.jobs) {
      if (!currGroup || (job.group !== currGroup.group) || !job.group) {
        currGroup = { group: job.group, jobs: [] };
        groups.push(currGroup);
      }
      currGroup.jobs.push(job);
    }
    return groups;
  }

  eventSource.onerror = (error) => {
    if (!['passed', 'failed'].includes(state.status)) {
      state.status = 'aborted';
    }
    if (!['passed', 'failed'].includes(job.status)) {
      job.status = 'aborted';
    }
    for (const job of state.jobs) {
      if (['running', 'queued', 'pending'].includes(job.status)) {
        job.status = 'canceled';
      }
    }
    eventSource.close();
  };

  // limit speed of log rendering
  const LOG_RATE_LIMIT = 0.01 * 1000;

  if (jobName) {
    const jobEventSource = new EventSource('/logs/' + jobName + '?t=' + new Date().getTime());
    const jobEventSourceHandler = (event) => {
      const { message, data } = JSON.parse(event.data);
      if (message === 'log') {
        logLength += data.length;
        
        // limit the number of logs visible on the webpage to prevent
        // performance issues
        while (logLength > MAX_LOG_LENGTH) {
          let log = jobLogs.shift();
          logLength -= (log?.length || 0);
        }

        let dataArr = data.split('\n');
        if (dataArr[dataArr.length - 1] === '') {
          dataArr = dataArr.slice(0, dataArr.length - 1);
        }
        jobLogs = [...jobLogs, ...dataArr];
        scrollToBottom(); // Scroll to the bottom after updating logs
      }
    };
    jobEventSource.onmessage = rateLimitedFunction(jobEventSourceHandler, LOG_RATE_LIMIT);
  }

  if(mockState) {
    onMount(() => {
      // if we're mocking add a mock job json to the page
      const script = document.createElement('script');
      script.src = '/js/' + mockState + '.state.js'; // Update with your script path
      script.async = true;
      document.head.appendChild(script);
      let interval = setInterval(() => {
        if (window.MOCK_STATE) {
          state = window.MOCK_STATE;
          groups = groupJobs(state);
          clearInterval(interval);
        }
      }, 1000);
    });
  }

  // Function to scroll to the bottom of the logs
  const scrollToBottom = () => {
    const logsElement = document.querySelector('.logs');
    if (logsElement) {
      logsElement.scrollTop = logsElement.scrollHeight;
    }
  };
</script>

<svelte:head>
  <title>{jobName || state.pipelineFileBasename} -- Carry-On</title>
</svelte:head>
<main>
  {#if Object.keys(state).length === 0}
    <LinearProgress indeterminate />
  {/if}
  {#if state}
  {#if !job && state && state.jobs}
    <h1>{state.pipelineFileBasename}</h1>
    <h4>PIPELINE STATUS: {state.status}</h4>
    <h4>PIPELINE RESULT: {state.result}</h4>
    <hr />
    {#each groups as group}
      {#if group.group }
        <hr />
        <h4>{group.group}</h4>
      {/if}
      {#each group.jobs as job}
        {#if job.result !== 'skipped' }
        <div class="job-card">
          <a class="job-card-{job.status}" href="/?job={job.name}">
            <Card class="job-card-{job.status}">
              <h3>{job.name}</h3>
              <Content>{job.status}</Content>
            </Card>
          </a>
        </div>
        {/if}
      {/each}
      {#if group.group }<hr />{/if}
    {/each}
  {/if}
  {/if}
  {#if job }
    <h4>JOB NAME: {job.name}</h4>
    <h4>JOB ID: {job.id}</h4>
    <h4>STATUS: {job.status}</h4>
    <h4>RESULT: {job.result}</h4>
    {#if ['passed', 'failed', 'running'].includes(job.status)}
      <a href={`/logs/${job.name}/download`}>Download logfile</a>
    {/if}
    {#if ['passed', 'failed'].includes(job.status) && job.artifactsDir}
      <a href={`/artifacts/${job.name}/download`}>Download artifacts</a>
    {/if}
    <div class="logs">
      {#if job.status !== 'pending' && job.status !== 'queued' }
        {#each jobLogs as jobLog}{jobLog}<br>{/each}
      {/if}
    </div>
  {/if}
</main>

<style>
  :global(#app) {
    background-color: #a0d9ef;
    min-height: 100vh;
  }
  :global(body) {
    place-items: start;
  }
  h1 {
    font-size: 32px;
  }
  main {
    text-align: left;
  }
  .logs {
    height: 550px;
    max-height: 70vh;
    overflow-y: auto;
    padding: 1em;
    text-align: left;
    font-family: 'Courier New', Courier, monospace;
    color: #FFF1F1F1;
    font-size: 12px;
    background-color: #333232;
  }
  * :global(.hello-world) {
    background-color: blue;
  }
  .job-card {
    padding: 0;
    margin-bottom: 2em;
    margin-right: 1em;
    text-align: left;
    cursor: pointer;
    min-width: 15em;
    * {
      padding: 0;
    }

    a {
      color: #000;
    }
    * :global(.job-card-passed) {
      color: #28a745 !important;
      background-color: #d4edda; /* Light green background */
    }
    * :global(.job-card-pending) {
      color: #6c757d;
      background-color: #e2e3e5; /* Light gray background */
    }
    * :global(.job-card-failed) {
      color: #dc3545;
      background-color: #f8d7da; /* Light red background */
    }
    * :global(.job-card-running) {
      color: #007BFF;
      background-color: #cce5ff; /* Light blue background */
    }
    h3 {
      padding-left: 1em;
      margin-bottom: 0;
    }
  }
</style>
