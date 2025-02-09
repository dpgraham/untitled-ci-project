<script>
  import { onMount } from 'svelte';
  import Card, { Content } from '@smui/card';
  import './global.scss';

  let state, jobLogs = [], job, id;
  
  // Get the query parameter "mockState"
  const urlParams = new URLSearchParams(window.location.search);
  const jobName = urlParams.get('job');
  const mockState = urlParams.get('mockState');  
  
  // Start an SSE session
  const eventSource = !mockState ? new EventSource('/events') : {};

  eventSource.onmessage = (event) => {
    const obj = JSON.parse(event.data);
    if (obj.message === 'state') {
      state = obj.state;
      if (jobName) {
        for (let checkJob of state.jobs) {
          if (checkJob.name === jobName) {
            job = checkJob;
            break;
          }
        }
        // if ID is different, it means the job was restarted so 
        // clear the logs
        if (id !== job?.id) {
          jobLogs = [];
          id = job?.id;
        }
      }
    }
  };

  eventSource.onerror = (error) => {
    eventSource.close(); // Close the connection on error
  };

  if (jobName) {
    const jobEventSource = new EventSource('/logs/' + jobName);
    jobEventSource.onmessage = (event) => {
      const { message, data } = JSON.parse(event.data);
      if (message === 'log') {
        let dataArr = data.split('\n');
        if (dataArr[dataArr.length - 1] === '') {
          dataArr = dataArr.slice(0, dataArr.length - 1);
        }
        jobLogs = [...jobLogs, ...dataArr];
        // scrollToBottom(); // Scroll to the bottom after updating logs
      }
    };
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
          clearInterval(interval);
        }
      }, 1000);
    });
  }

  // Function to scroll to the bottom of the logs
  // TODO: Get this working, it's not doing anything
  // const scrollToBottom = () => {
  //   const logsElement = document.querySelector('.logs');
  //   if (logsElement) {
  //     logsElement.scrollTop = logsElement.scrollHeight;
  //     console.log('scrolling logs to bottom', logsElement.scrollTop, logsElement.scrollHeight);
  //   }
  // };

</script>

<main>
  <!-- TODO: if no "state" then show a loading indicator here -->
  {#if state}
  <h4>PIPELINE: {state.pipelineFile}</h4>
  <h4>STATUS: {state.result}</h4>
  {#if !jobName && state && state.jobs}
      <!-- TODO: color code the state of each job -->
      {#each state.jobs as job}
        <div class="custom-card">
          <a class="job-card-{job.status}" href="/?job={job.name}">
            <Card class="job-card-{job.status}">
              <h3>Job Name: {job.name}</h3>
              <Content>{job.status}</Content>
            </Card>
          </a>
        </div>
      {/each}
  {/if}
  {#if job }
    <div>{job.name}</div>
    <div>ID: {job.id}</div>
    <div class="logs">
      {#each jobLogs as jobLog}{jobLog}<br>{/each}
    </div>
  {/if}
  {/if}
</main>

<style>
  :global(body) {
    place-items: start;
  }
  main {
    text-align: left;
  }
  .logs {
    height: 550px;
    max-height: 75vh;
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
  /* todo: rename this to job-card */
  .custom-card {
    margin-bottom: 2em;
    text-align: left;
    cursor: pointer;
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
