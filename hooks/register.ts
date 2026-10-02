export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'todos', description: 'Toggle the todo ledger pane', immediate: true })
    return next(e)
  })
}
