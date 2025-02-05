<script>
  import { onMount } from 'svelte';
  import Card, { Content } from '@smui/card';
  import './global.scss';

  let state;
  
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
    <div>{jobName} placeholder</div>
  {/if}
</main>

<style>
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
