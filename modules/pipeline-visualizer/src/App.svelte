<script>
  import { onMount } from 'svelte';
  import Card, { Content } from '@smui/card';
  import './global.scss';

  let state, jobLogs;
  
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
    }
  };

  eventSource.onerror = (error) => {
    eventSource.close(); // Close the connection on error
  };

  if (jobName) {
    jobLogs = [];
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

  // Dynamically add a script tag
  if(mockState) {
    onMount(() => {
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
  {#if !jobName && state && state.jobs}
      {#each state.jobs as job}
        <div class="custom-card">
          <a href="/?job={job.name}">
            <Card>
              <h3>Job Name: {job.name}</h3>
              <Content>{job.status}</Content>
            </Card>
          </a>
        </div>
      {/each}
  {/if}
  {#if jobName }
    <div class="logs">
    {#each jobLogs as jobLog}{jobLog}<br>{/each}
    </div>
  {/if}
</main>

<style>
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
  .custom-card {
    margin-bottom: 2em;
    text-align: left;
    cursor: pointer;
    a {
      color: #000;
    }
    h3 {
      padding-left: 1em;
      margin-bottom: 0;
    }
  }
</style>
