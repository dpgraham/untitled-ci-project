<script>
  import { onMount } from 'svelte';
  import Card, { PrimaryAction } from '@smui/card';
  import Paper, { Title, Content } from '@smui/paper';
  import './global.scss';

  let state;
  
  // Get the query parameter "mockState"
  const urlParams = new URLSearchParams(window.location.search);
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
  {#if state && state.jobs}
      {#each state.jobs as job}
        <Paper square variant="outlined">
          <Title>{job.name}</Title>
          <Content>{job.status}</Content>
        </Paper>
      {/each}
  {/if}
  
</main>

<style>
</style>
