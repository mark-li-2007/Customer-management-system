import app from './app.js';
import { runRecycleCheck } from './services/recycleJob.js';

const port = Number(process.env.PORT || 4174);
runRecycleCheck();
setInterval(runRecycleCheck, 60 * 1000).unref();

app.listen(port, () => {
  console.log(`CRM API running at http://localhost:${port}/api`);
});
