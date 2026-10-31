/**
 * Host half of the bundle.
 *
 * The widget is pure Client UI: it reads the account Remote and renders in
 * `conversation.composer.dock`. The empty Host body exists so the Loader can
 * mount the row; the browser module ships through the package's `./client`
 * export and `dsh.client` declaration.
 */
export function apply() {}
