export const t = (key, data = {}) => game.i18n.format(`TERM_SHARE.${key}`, data);
export function report(error) {
  console.error("Term Share |", error);
  ui.notifications.error(error?.key ? t(error.key, error.data) : t("UnexpectedError"));
}
