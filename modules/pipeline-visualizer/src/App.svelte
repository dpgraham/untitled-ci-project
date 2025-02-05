<script>
  import { onMount } from 'svelte';

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
    <ul>
      {#each state.jobs as job}
        <li>{job.name} -- {job.status}</li>
      {/each}
    </ul>
  {/if}
  
</main>

<style>
  .logo {
    height: 6em;
    padding: 1.5em;
    will-change: filter;
    transition: filter 300ms;
  }
  .logo:hover {
    filter: drop-shadow(0 0 2em #646cffaa);
  }
  .logo.svelte:hover {
    filter: drop-shadow(0 0 2em #ff3e00aa);
  }
  .read-the-docs {
    color: #888;
  }
</style>
