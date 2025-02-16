export function rateLimitedFunction (func, delay) {
  const queue = [];
  let timer = null;

  return function (...args) {
    queue.push({ func, args });

    if (!timer) {
      processQueue();
    }
  };

  function processQueue () {
    if (queue.length === 0) {
      timer = null;
      return;
    }

    const { func, args } = queue.shift();
    func(...args);

    timer = setTimeout(processQueue, delay);
  }
}
