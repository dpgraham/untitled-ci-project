<script>
  import svelteLogo from './assets/svelte.svg';
  import viteLogo from '/vite.svg';

  // Start an SSE session
  const eventSource = new EventSource('/events');

  let state;

  // TODO: handle case of user trying to refresh or re-open page that it gets the state

  eventSource.onmessage = (event) => {
    console.log('New message from server:', event.data);
    const obj = JSON.parse(event.data);
    if (obj.message === 'state') {
      state = obj.state;
    }
  };

  eventSource.onerror = (error) => {
    console.error('Error occurred:', error);
    eventSource.close(); // Close the connection on error
  };
</script>

<main>
  <div>
    <!-- TODO: Change this to internal logo -->
    <a href="https://vite.dev" target="_blank" rel="noreferrer">
      <img src={viteLogo} class="logo" alt="Vite Logo" />
    </a>
    <a href="https://svelte.dev" target="_blank" rel="noreferrer">
      <img src={svelteLogo} class="logo svelte" alt="Svelte Logo" />
    </a>
  </div>
  <h1>Pipeline</h1>
  <pre>{JSON.stringify(state, null, 2)}</pre>
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
