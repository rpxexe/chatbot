import { app } from "./app.js";
import { migrate } from "./db.js";

await migrate();
const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`API on http://localhost:${port}`));
