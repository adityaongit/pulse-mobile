// try / catch / finally as a function call. The React Compiler skips a whole component when one of its handlers holds
// a `finally` clause, a `try` without a `catch`, or a conditional inside a `try`; a skipped component is not memoised,
// so it and everything under it render on every change. A handler written with `attempt` keeps the same behaviour and
// leaves the component compiled. A `return` in `run` ends `run` only: keep nothing after the call that it must skip.
export async function attempt(
  run: () => Promise<unknown>,
  on: { catch?: (e: unknown) => unknown; finally?: () => unknown },
): Promise<void> {
  try {
    await run();
  } catch (e) {
    if (!on.catch) throw e;
    await on.catch(e);
  } finally {
    await on.finally?.();
  }
}
