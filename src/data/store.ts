// The app's one Store: the repositories over the app's database. Screens, sync and the pipeline all use this.
import { db } from "./db";
import { createStore } from "./repos";

export const store = createStore(db);
