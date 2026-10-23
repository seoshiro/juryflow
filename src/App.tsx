import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useScheduler } from "./useScheduler";
import {
  downloadText,
  exportICS,
  parseDocument,
  serializeDocument,
  slotLabel,
  MAX_DOCUMENT_BYTES,
} from "./io";
import { validateSchedule } from "./engine";
import { sameAssignment } from "./assignment";
import { issueText } from "./issueText";
import type { Assignment, Project, Team, SavedDocument } from "./types";
import { Icon } from "./components/Icon";
import { SlotPicker } from "./components/SlotPicker";
import { NumericField } from "./components/NumericField";
import "./styles.css";

type View = "schedule" | "teams" | "judges" | "rooms" | "settings";
type ScheduleTab = "schedule" | "changes";

function Dialog({
  title,
  onClose,
  children,
  language,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  language: "en" | "ru";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const restoreFrame = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (restoreFrame.current !== undefined)
      cancelAnimationFrame(restoreFrame.current);
    const dialog = ref.current;
    if (
      !opener.current &&
      window.document.activeElement instanceof HTMLElement
    ) {
      opener.current = window.document.activeElement;
    }
    dialog?.showModal();
    return () => {
      dialog?.close();
      restoreFrame.current = requestAnimationFrame(() => {
        if (dialog?.isConnected && dialog.open) return;
        const target = opener.current?.isConnected
          ? opener.current
          : window.document.getElementById("main-content");
        target?.focus();
      });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="detail-dialog"
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-top">
        <div>
          <span className="eyebrow">
            {language === "ru"
              ? "JURYFLOW / ПОДРОБНОСТИ"
              : "JURYFLOW / DETAILS"}
          </span>
          <h2 id="dialog-title">{title}</h2>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label={
            language === "ru" ? "Закрыть подробности" : "Close details"
          }
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
      <div className="dialog-bottom">
        <span className="field-hint">
          {language === "ru"
            ? "Изменения сохраняются на этом устройстве."
            : "Changes save on this device."}
        </span>
        <button className="button primary" onClick={onClose}>
          {language === "ru" ? "Готово" : "Done"}{" "}
          <Icon name="check" size={16} />
        </button>
      </div>
    </dialog>
  );
}

export default function App() {
  const {
    document: doc,
    setDocument: setStoredDocument,
    setLanguage,
    replaceDocument,
    result,
    busy,
    error,
    run,
    cancel,
    resetDemo,
    clearError,
    recovery,
    discardRecovery,
    saveState,
  } = useScheduler();
  const importSequence = useRef(0);
  const setDocument: Dispatch<SetStateAction<SavedDocument>> = (value) => {
    importSequence.current++;
    setStoredDocument(value);
  };
  const project = doc.project;
  const [view, setView] = useState<View>("schedule");
  const [scheduleTab, setScheduleTab] = useState<ScheduleTab>("schedule");
  const [detailTeam, setDetailTeam] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [fileError, setFileError] = useState("");
  const [outageJudge, setOutageJudge] = useState("");
  const [outageSlot, setOutageSlot] = useState(2);
  const [showOutage, setShowOutage] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    importSequence.current++;
  }, [doc.project, doc.schedule, doc.baseline]);
  const language = doc.language;
  useEffect(() => {
    window.document.documentElement.lang = language;
  }, [language]);
  const t = (en: string, ru: string) => (language === "ru" ? ru : en);
  const slots = Array.from({ length: project.slotCount }, (_, i) => i);
  const complete =
    project.teams.length > 0 && doc.schedule.length === project.teams.length;
  const scheduleIssues = complete
    ? validateSchedule(project, doc.schedule)
    : [];
  const ready = complete && scheduleIssues.length === 0;
  const previous = doc.baseline;
  const effectiveOutageSlot = Math.min(outageSlot, project.slotCount - 1);
  const effectiveOutageJudge = project.judges.some((j) => j.id === outageJudge)
    ? outageJudge
    : project.judges[0]?.id || "";
  const eventDate = new Date(`${project.date}T12:00:00Z`);
  const dateLabel = Number.isFinite(eventDate.getTime())
    ? eventDate.toLocaleDateString(language === "en" ? "en-GB" : "ru-RU", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : t("Choose an event date", "Выберите дату");
  const changes =
    ready && previous.length
      ? doc.schedule.filter((a) => {
          const b = previous.find((x) => x.teamId === a.teamId);
          return !b || !sameAssignment(a, b);
        })
      : [];
  const unchanged =
    ready && previous.length ? doc.schedule.length - changes.length : 0;
  const team = project.teams.find((x) => x.id === detailTeam);
  const assignment = doc.schedule.find((x) => x.teamId === detailTeam);
  const locked = (id: string) => project.locks.some((a) => a.teamId === id);
  const judgeName = (id: string) =>
    project.judges.find((x) => x.id === id)?.name || id;
  const roomName = (id: string) =>
    project.rooms.find((x) => x.id === id)?.name || id;
  const initials = (name: string) =>
    name
      .split(" ")
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();

  function updateProject(update: (p: Project) => Project) {
    setDocument((current) => ({
      ...current,
      project: update(current.project),
      baseline: current.schedule.length ? current.schedule : current.baseline,
      schedule: [],
    }));
    setNotice("");
  }
  function updateTeam(id: string, patch: Partial<Team>) {
    updateProject((p) => ({
      ...p,
      teams: p.teams.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    }));
  }
  function setLock(a: Assignment, value: boolean) {
    setDocument((current) => ({
      ...current,
      project: {
        ...current.project,
        locks: [
          ...current.project.locks.filter((x) => x.teamId !== a.teamId),
          ...(value ? [a] : []),
        ],
      },
    }));
    setNotice(
      value
        ? t(
            "Assignment locked. Replanning will keep it exactly here.",
            "Назначение закреплено. Перепланирование сохранит его.",
          )
        : t("Assignment unlocked.", "Назначение откреплено."),
    );
  }
  function simulateOutage() {
    const judge = project.judges.find((j) => j.id === effectiveOutageJudge);
    if (!judge) return;
    updateProject((p) => ({
      ...p,
      judges: p.judges.map((j) =>
        j.id === judge.id
          ? {
              ...j,
              availableSlots: j.availableSlots.filter(
                (s) => s < effectiveOutageSlot,
              ),
            }
          : j,
      ),
    }));
    setNotice(
      t(
        `${judge.name} is unavailable from ${slotLabel(project, effectiveOutageSlot)}. Replan to repair the schedule.`,
        `${judge.name} недоступен с ${slotLabel(project, effectiveOutageSlot)}. Перепланируйте расписание.`,
      ),
    );
    setShowOutage(false);
    setScheduleTab("schedule");
  }
  async function importFile(file?: File) {
    const operation = ++importSequence.current;
    if (!file) return;
    if (file.size > MAX_DOCUMENT_BYTES) {
      setFileError(
        t(
          "File is too large. Maximum size is 2 MB.",
          "Файл слишком большой. Максимум 2 МБ.",
        ),
      );
      return;
    }
    // A file selected now supersedes any older solver before its asynchronous read.
    // Otherwise that solver can change the document and invalidate this import.
    if (busy) cancel();
    try {
      const source = await file.text();
      if (operation !== importSequence.current) return;
      const parsed = parseDocument(source);
      if (!parsed.ok) {
        setFileError(parsed.error);
        return;
      }
      if (
        recovery &&
        !window.confirm(
          t(
            "Replace the unreadable saved data with this import? Download the recovery data first if you need to keep it.",
            "Заменить нечитаемые сохранённые данные этим импортом? Сначала скачайте исходные данные, если хотите сохранить их.",
          ),
        )
      )
        return;
      if (operation !== importSequence.current) return;
      if (!replaceDocument(parsed.value)) return;
      setFileError("");
      setNotice(
        t(
          "Workspace imported and validated.",
          "Рабочая область импортирована и проверена.",
        ),
      );
      setView("schedule");
    } catch {
      if (operation !== importSequence.current) return;
      setFileError(
        t(
          "Could not read this file. Choose a valid JURYFLOW JSON file.",
          "Не удалось прочитать файл. Выберите JSON-файл JURYFLOW.",
        ),
      );
    }
  }
  function exportJSON() {
    try {
      const serialized = serializeDocument(doc);
      const checked = parseDocument(serialized);
      if (!checked.ok) {
        setFileError(
          t(
            "Complete required event fields before exporting JSON. Names, date and time must be valid.",
            "Заполните обязательные поля перед экспортом JSON. Проверьте названия, дату и время.",
          ) +
            " " +
            checked.error,
        );
        return;
      }
      downloadText("juryflow-workspace.json", serialized, "application/json");
      setNotice(
        t(
          "Workspace exported, including constraints and schedule.",
          "Рабочая область экспортирована с ограничениями и расписанием.",
        ),
      );
    } catch (cause) {
      setFileError(
        t("Could not export JSON: ", "Не удалось экспортировать JSON: ") +
          (cause instanceof Error
            ? cause.message
            : t("Unknown export error.", "Неизвестная ошибка экспорта.")),
      );
    }
  }
  function exportCalendar() {
    if (ready) {
      downloadText(
        "juryflow-schedule.ics",
        exportICS(project, doc.schedule),
        "text/calendar",
      );
      setNotice(
        t(
          "Calendar exported. Times are in UTC.",
          "Календарь экспортирован. Время в UTC.",
        ),
      );
    }
  }
  function printSchedule() {
    if (!ready) return;
    setView("schedule");
    setScheduleTab("schedule");
    setTimeout(() => window.print(), 0);
  }
  function reset() {
    importSequence.current++;
    if (
      recovery &&
      !window.confirm(
        t(
          "Discard the unreadable saved data and start the demo? Download the recovery data first if you need to keep it.",
          "Удалить нечитаемые сохранённые данные и начать демо? Сначала скачайте исходные данные, если хотите сохранить их.",
        ),
      )
    )
      return;
    cancel();
    if (recovery) discardRecovery();
    resetDemo();
    setView("schedule");
    setDetailTeam(null);
    setScheduleTab("schedule");
    setNotice(
      t(
        "Demo restored. Generate a fresh schedule to begin.",
        "Демо восстановлено. Сгенерируйте расписание.",
      ),
    );
    setFileError("");
  }
  const nav = [
    {
      id: "schedule" as const,
      icon: "grid",
      label: t("Schedule", "Расписание"),
      count: null,
    },
    {
      id: "teams" as const,
      icon: "people",
      label: t("Teams", "Команды"),
      count: project.teams.length,
    },
    {
      id: "judges" as const,
      icon: "judge",
      label: t("Judges", "Жюри"),
      count: project.judges.length,
    },
    {
      id: "rooms" as const,
      icon: "room",
      label: t("Rooms", "Аудитории"),
      count: project.rooms.length,
    },
    {
      id: "settings" as const,
      icon: "settings",
      label: t("Event setup", "Настройки"),
      count: null,
    },
  ];
  const statusTitle = busy
    ? t("Finding everyone a place…", "Ищем место для каждого…")
    : ready
      ? t(
          "All clear. Every team has a place.",
          "Всё готово. Каждой команде нашлось место.",
        )
      : result?.status === "infeasible"
        ? t(
            "These constraints cannot all be met.",
            "Эти ограничения несовместимы.",
          )
        : result?.status === "unknown"
          ? t(
              "Search limit reached. No conclusion yet.",
              "Лимит поиска. Вывод пока не сделан.",
            )
          : result?.status === "cancelled"
            ? t("Search cancelled. You can try again.", "Поиск отменён. Можно попробовать снова.")
          : previous.length
            ? t(
                "The plan changed. Let’s put it back in order.",
                "Условия изменились. Соберём расписание заново.",
              )
            : t(
                "Your pitch day, ready to take shape.",
                "Ваш день выступлений готов к планированию.",
              );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {t("Skip to workspace", "Перейти к рабочей области")}
      </a>
      <aside className="sidebar no-print">
        <a href="#main-content" className="brand" aria-label="Juryflow home">
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          JURYFLOW<span className="brand-dot">®</span>
        </a>
        <div className="workspace-label">
          <span className="eyebrow">
            {t("YOUR WORKSPACE", "РАБОЧАЯ ОБЛАСТЬ")}
          </span>
          <span className="workspace-name">
            {t("The operations desk", "Центр управления")} <span>↗</span>
          </span>
        </div>
        <nav
          aria-label={t("Workspace navigation", "Навигация")}
          className="main-nav"
        >
          {nav.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setView(item.id);
                setDetailTeam(null);
              }}
              aria-current={view === item.id ? "page" : undefined}
              className={`nav-item ${view === item.id ? "active" : ""}`}
            >
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
              {item.count !== null && (
                <span className="nav-count">
                  {item.count.toString().padStart(2, "0")}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="tiny-signal" />
          {t("LOCAL-FIRST. HUMAN-READY.", "ЛОКАЛЬНО. ДЛЯ ЛЮДЕЙ.")}
          <p>
            {t(
              "Big ideas deserve a day that runs beautifully.",
              "Большие идеи заслуживают отлично организованного дня.",
            )}
          </p>
          <div className="note-line" />
        </div>
        <div className="sidebar-bottom">
          <div className="profile-monogram">B</div>
          <div>
            <strong>Beibars</strong>
            <span>
              {t("Built for better pitch days", "Для лучших дней выступлений")}
            </span>
          </div>
          <a
            href="https://github.com/seoshiro/juryflow"
            target="_blank"
            rel="noreferrer"
            aria-label={t(
              "JURYFLOW source on GitHub",
              "Исходный код JURYFLOW на GitHub",
            )}
          >
            ↗
          </a>
        </div>
      </aside>

      <div className="workspace-shell">
        <header className="topbar no-print">
          <div className="breadcrumb">
            {t("Workspace", "Рабочая область")}
            <span>/</span>
            <strong>{nav.find((n) => n.id === view)?.label}</strong>
          </div>
          <div className="topbar-tools">
            <span className="local-save">
              <span />
              {recovery || saveState === "paused"
                ? t("Autosave paused", "Автосохранение приостановлено")
                : saveState === "error"
                  ? t("Not saved on device", "Не сохранено на устройстве")
                  : t("Saved on device", "Сохранено локально")}
            </span>
            <button
              className="language-button"
              onClick={() =>
                setLanguage(language === "en" ? "ru" : "en")
              }
              aria-label={
                language === "en"
                  ? "EN — Switch to Russian"
                  : "RU — Переключить на английский"
              }
            >
              <Icon name="globe" size={15} />
              {language === "en" ? "EN" : "RU"}
            </button>
            <button
              className="button subtle import-top"
              onClick={() => fileInput.current?.click()}
            >
              <Icon name="upload" size={15} />
              {t("Import JSON", "Импорт JSON")}
            </button>
            <input
              type="file"
              ref={fileInput}
              accept=".json,application/json"
              aria-label={t("Import JSON", "Импорт JSON")}
              className="visually-hidden"
              onChange={(e) => {
                void importFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        </header>

        <main id="main-content" className="main-content" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <div className="eyebrow heading-eyebrow">
                <span className="tiny-cross">+</span>
                {t(
                  "PITCH DAY / CONTROL ROOM",
                  "ДЕНЬ ПИТЧЕЙ / ПУЛЬТ УПРАВЛЕНИЯ",
                )}
              </div>
              <h1>
                {view === "schedule"
                  ? t("Great ideas. Right on time.", "Идеи — вовремя.")
                  : nav.find((n) => n.id === view)?.label}
                <span className="heading-period">.</span>
              </h1>
              <p>
                {view === "schedule"
                  ? t(
                      "One clear plan for every team, judge and room.",
                      "Единый понятный план для каждой команды, судьи и аудитории.",
                    )
                  : t(
                      "Shape the constraints. We’ll handle the moving parts.",
                      "Задайте ограничения. Мы свяжем всё в единый план.",
                    )}
              </p>
            </div>
            <div className="page-actions no-print">
              <button className="button subtle" onClick={exportJSON}>
                <Icon name="download" size={16} />
                {t("Export JSON", "Экспорт JSON")}
              </button>
              <button
                className="icon-button print-button"
                onClick={printSchedule}
                disabled={!ready}
                aria-label={t("Print schedule", "Распечатать расписание")}
                title={t("Print schedule", "Распечатать расписание")}
              >
                <Icon name="print" />
              </button>
            </div>
          </div>

          {recovery && (
            <section
              className="recovery-banner no-print"
              role="alert"
              aria-labelledby="recovery-title"
            >
              <Icon name="alert" />
              <div>
                <strong id="recovery-title">
                  {t(
                    "Your saved data needs recovery",
                    "Сохранённые данные требуют восстановления",
                  )}
                </strong>
                <p>{recovery.message}</p>
                <p>
                  {t(
                    "Autosave is paused to protect the existing data. Download the original data before replacing it, or import a valid backup. Ordinary edits will not overwrite it.",
                    "Автосохранение приостановлено для защиты исходных данных. Скачайте их перед заменой или импортируйте корректную резервную копию. Обычные правки не перезапишут исходные данные.",
                  )}
                </p>
                <div className="recovery-actions">
                  <button
                    className="button subtle"
                    disabled={recovery.raw === null}
                    onClick={() => {
                      if (recovery.raw !== null)
                        downloadText(
                          "juryflow-recovery.txt",
                          recovery.raw,
                          "text/plain;charset=utf-8",
                        );
                    }}
                  >
                    {t("Download recovery data", "Скачать исходные данные")}
                  </button>
                  <button className="button subtle" onClick={reset}>
                    {t(
                      "Discard saved data and start demo",
                      "Удалить сохранённые данные и начать демо",
                    )}
                  </button>
                </div>
              </div>
            </section>
          )}
          {(fileError || error) && (
            <div className="message error-message" role="alert">
              <Icon name="alert" />
              <span>{fileError || error}</span>
              <button
                className="icon-button"
                aria-label={t("Dismiss error", "Закрыть ошибку")}
                onClick={() => {
                  setFileError("");
                  clearError();
                }}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="notice no-print" role="status">
              <Icon name="check" size={16} />
              <span>{notice}</span>
              <button
                className="icon-button"
                aria-label={t("Dismiss notification", "Закрыть уведомление")}
                onClick={() => setNotice("")}
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          )}

          <div className="event-bar">
            <div className="event-name">
              <span className="event-symbol">✳</span>
              <div>
                <strong>{project.name}</strong>
                <span>
                  {dateLabel}
                  <b>·</b>
                  {project.startTime} UTC<b>·</b>
                  {project.id === "juryflow-demo"
                    ? t("Synthetic demo data", "Синтетические демо-данные")
                    : t("Local event data", "Локальные данные события")}
                </span>
              </div>
            </div>
            <div className="event-stats">
              <div>
                <strong>
                  {project.teams.length.toString().padStart(2, "0")}
                </strong>
                <span>{t("teams", "команд")}</span>
              </div>
              <div>
                <strong>
                  {project.judges.length.toString().padStart(2, "0")}
                </strong>
                <span>{t("judges", "судьи")}</span>
              </div>
              <div>
                <strong>
                  {project.rooms.length.toString().padStart(2, "0")}
                </strong>
                <span>{t("rooms", "зала")}</span>
              </div>
              <div>
                <strong>
                  {project.slotMinutes}
                  <small>m</small>
                </strong>
                <span>{t("per pitch", "на питч")}</span>
              </div>
            </div>
          </div>

          {view === "schedule" && (
            <>
              <section
                className={`status-strip ${ready ? "is-ready" : result?.status === "infeasible" ? "is-error" : ""}`}
                aria-label={t("Schedule status", "Статус расписания")}
              >
                <div className={`status-symbol ${busy ? "spinning" : ""}`}>
                  <Icon
                    name={
                      busy
                        ? "reset"
                        : ready
                          ? "check"
                          : result?.status === "infeasible"
                            ? "alert"
                            : "spark"
                    }
                    size={21}
                  />
                </div>
                <div className="status-copy">
                  <strong data-testid="status" aria-live="polite">
                    {statusTitle}
                  </strong>
                  <span>
                    {ready
                      ? t(
                          `All ${project.teams.length} pitches satisfy availability, judge requirements and room constraints.`,
                          `Все ${project.teams.length} выступлений соответствуют ограничениям.`,
                        )
                      : busy
                        ? t(
                            "Searching in a background worker. You can cancel at any time.",
                            "Поиск идёт в фоновом потоке. Его можно отменить.",
                          )
                        : t(
                            "Availability, conflicts of interest and locked assignments are hard constraints.",
                            "Доступность, конфликты интересов и закрепления — строгие ограничения.",
                          )}
                  </span>
                </div>
                <div className="status-actions no-print">
                  {busy ? (
                    <button className="button primary" onClick={cancel}>
                      {t("Cancel search", "Отменить поиск")}
                    </button>
                  ) : (
                    <button
                      className="button primary"
                      onClick={() => {
                        importSequence.current++;
                        setNotice("");
                        run(previous.length ? previous : undefined);
                      }}
                      data-testid="schedule-action"
                    >
                      <Icon
                        name={previous.length && !ready ? "reset" : "spark"}
                        size={16}
                      />
                      {previous.length && !ready
                        ? t("Replan schedule", "Перепланировать")
                        : ready
                          ? t("Regenerate", "Сгенерировать заново")
                          : t("Generate schedule", "Сгенерировать")}
                      <span className="button-short-arrow" aria-hidden="true">
                        ↗
                      </span>
                    </button>
                  )}
                </div>
              </section>
              {!busy &&
                !ready &&
                result &&
                result.status !== "feasible" &&
                result.status !== "cancelled" && (
                  <section
                    className="diagnostics"
                    aria-label={t(
                      "Constraint explanation",
                      "Объяснение ограничений",
                    )}
                  >
                    <div className="eyebrow">
                      {result.status === "infeasible"
                        ? t("WHAT’S BLOCKING THE DAY", "ЧТО МЕШАЕТ РАСПИСАНИЮ")
                        : t("SEARCH PAUSED", "ПОИСК ОСТАНОВЛЕН")}
                    </div>
                    <ul>
                      {result.issues.map((issue, i) => (
                        <li key={`${issue.code}-${i}`}>{issueText(issue, project, language)}</li>
                      ))}
                    </ul>
                    <p>
                      {result.status === "infeasible"
                        ? t(
                            "These checks explain the conflict; this is not a proven smallest set of causes. Adjust constraints or unlock affected assignments, then try again.",
                            "Проверки объясняют конфликт; это не доказанный минимальный набор причин. Измените ограничения или снимите закрепления и попробуйте снова.",
                          )
                        : t(
                            "The bounded search could not settle this workspace. This does not prove infeasibility. Try reducing constraints or the workspace size.",
                            "Ограниченный поиск не дал ответа. Это не доказывает несовместимость. Упростите ограничения или уменьшите размер задачи.",
                          )}
                    </p>
                  </section>
                )}

              <div className="operations-layout">
                <section className="schedule-section">
                  <div className="section-toolbar">
                    <div
                      className="segmented-tabs no-print"
                      onKeyDown={(event) => {
                        if (
                          ["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                            event.key,
                          )
                        ) {
                          event.preventDefault();
                          const nextTab =
                            event.key === "Home"
                              ? "schedule"
                              : event.key === "End"
                                ? "changes"
                                : scheduleTab === "schedule"
                                  ? "changes"
                                  : "schedule";
                          setScheduleTab(nextTab);
                          const tabButtons =
                            event.currentTarget.querySelectorAll<HTMLButtonElement>(
                              '[role="tab"]',
                            );
                          tabButtons[nextTab === "schedule" ? 0 : 1]?.focus();
                        }
                      }}
                      role="tablist"
                      aria-label={t("Schedule views", "Виды расписания")}
                    >
                      <button
                        role="tab"
                        aria-selected={scheduleTab === "schedule"}
                        onClick={() => setScheduleTab("schedule")}
                      >
                        {t("Schedule", "Расписание")}
                        <span>{ready ? doc.schedule.length : "—"}</span>
                      </button>
                      <button
                        role="tab"
                        aria-selected={scheduleTab === "changes"}
                        onClick={() => setScheduleTab("changes")}
                      >
                        {t("Changes", "Изменения")}
                        <span className={changes.length ? "accent-count" : ""}>
                          {changes.length}
                        </span>
                      </button>
                    </div>
                    <div className="timezone">
                      <span className="tiny-signal" />
                      UTC
                      <span className="desktop-only">
                        {" "}
                        / {t("all rooms", "все залы")}
                      </span>
                    </div>
                  </div>
                  {scheduleTab === "schedule" ? (
                    <div
                      className="schedule-table"
                      style={
                        {
                          "--room-count": Math.max(project.rooms.length, 1),
                        } as CSSProperties
                      }
                      data-testid="schedule-grid"
                      role="region"
                      aria-label={t("Pitch schedule", "Расписание выступлений")}
                    >
                      <div
                        className="grid-header"
                        style={{
                          gridTemplateColumns: `66px repeat(${Math.max(project.rooms.length, 1)}, minmax(0, 1fr))`,
                        }}
                      >
                        <span>{t("TIME", "ВРЕМЯ")}</span>
                        {project.rooms.map((r, i) => (
                          <div key={r.id}>
                            <span className="room-order">0{i + 1}</span>
                            <strong>{r.name}</strong>
                            <Icon name="room" size={14} />
                          </div>
                        ))}
                      </div>
                      {slots.map((slot) => (
                        <div
                          className="schedule-row"
                          key={slot}
                          style={{
                            gridTemplateColumns: `66px repeat(${Math.max(project.rooms.length, 1)}, minmax(0, 1fr))`,
                          }}
                        >
                          <div className="time-label">
                            <strong>{slotLabel(project, slot)}</strong>
                            <span>{String(slot + 1).padStart(2, "0")}</span>
                          </div>
                          {project.rooms.map((room) => {
                            const a = ready
                              ? doc.schedule.find(
                                  (x) =>
                                    x.slot === slot && x.roomId === room.id,
                                )
                              : undefined;
                            const pitch = project.teams.find(
                              (x) => x.id === a?.teamId,
                            );
                            const changed = changes.some(
                              (c) => c.teamId === a?.teamId,
                            );
                            return (
                              <div
                                className={`grid-cell ${room.availableSlots.includes(slot) ? "" : "unavailable-cell"}`}
                                key={room.id}
                                data-room={room.name}
                              >
                                {a && pitch ? (
                                  <button
                                    data-testid="team-card"
                                    className={`pitch-card ${changed ? "changed" : ""}`}
                                    onClick={() => setDetailTeam(pitch.id)}
                                    aria-label={`${pitch.name}, ${slotLabel(project, slot)}, ${room.name}${locked(pitch.id) ? t(", locked", ", закреплено") : ""}`}
                                  >
                                    <span className="pitch-top">
                                      <span
                                        className={`track-marker marker-${project.teams.indexOf(pitch) % 4}`}
                                      />
                                      {pitch.track}
                                      <span className="pitch-index">
                                        {String(
                                          project.teams.indexOf(pitch) + 1,
                                        ).padStart(2, "0")}
                                      </span>
                                    </span>
                                    <strong>{pitch.name}</strong>
                                    <span className="pitch-bottom">
                                      <span className="judge-avatar">
                                        {initials(
                                          judgeName(a.judgeIds[0] || ""),
                                        )}
                                      </span>
                                      <span>
                                        {a.judgeIds.map(judgeName).join(", ")}
                                      </span>
                                      {locked(pitch.id) && (
                                        <Icon name="lock" size={12} />
                                      )}
                                      {changed && (
                                        <span className="changed-label">
                                          {t("changed", "изменено")}
                                        </span>
                                      )}
                                      <Icon name="chevron" size={13} />
                                    </span>
                                  </button>
                                ) : (
                                  <div className="empty-slot">
                                    <span>
                                      {!room.availableSlots.includes(slot)
                                        ? t(
                                            "Room unavailable",
                                            "Зал недоступен",
                                          )
                                        : ready
                                          ? t("Open slot", "Свободный слот")
                                          : "—"}
                                    </span>
                                    {ready &&
                                      room.availableSlots.includes(slot) && (
                                        <span className="empty-plus">+</span>
                                      )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                      {!ready && (
                        <div className="empty-schedule-overlay">
                          <div className="empty-symbol">
                            <Icon name="grid" size={28} />
                          </div>
                          <h3>
                            {previous.length
                              ? t(
                                  "A fresh plan starts here.",
                                  "Здесь появится новый план.",
                                )
                              : t(
                                  "A place for every idea.",
                                  "Место для каждой идеи.",
                                )}
                          </h3>
                          <p>
                            {previous.length
                              ? t(
                                  "Your previous schedule is kept for comparison. Replan to find a valid new arrangement.",
                                  "Прежнее расписание сохранено для сравнения. Перепланируйте, чтобы найти новый допустимый вариант.",
                                )
                              : t(
                                  "Add your constraints, then generate a schedule. Or start with our 12-team demo.",
                                  "Задайте ограничения и сгенерируйте расписание. Или начните с демо на 12 команд.",
                                )}
                          </p>
                          <span className="eyebrow">
                            {t(
                              `${project.teams.length} TEAMS. SCHEDULE NOT GENERATED.`,
                              `${project.teams.length} КОМАНД. РАСПИСАНИЕ НЕ СОЗДАНО.`,
                            )}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="changes-view">
                      {ready && previous.length ? (
                        <>
                          <div className="change-summary">
                            <strong>{changes.length}</strong>
                            <div>
                              <h3>{t("teams changed", "команд изменено")}</h3>
                              <p>
                                {unchanged}{" "}
                                {t(
                                  "assignments kept exactly as they were.",
                                  "назначений сохранены без изменений.",
                                )}
                              </p>
                            </div>
                          </div>
                          {changes.length ? (
                            changes.map((a) => {
                              const before = previous.find(
                                (b) => b.teamId === a.teamId,
                              );
                              return (
                                <div className="change-row" key={a.teamId}>
                                  <strong>
                                    {
                                      project.teams.find(
                                        (x) => x.id === a.teamId,
                                      )?.name
                                    }
                                  </strong>
                                  <span>
                                    {before
                                      ? `${slotLabel(project, before.slot)} · ${roomName(before.roomId)} · ${before.judgeIds.map(judgeName).join(", ")}`
                                      : t("New assignment", "Новое назначение")}
                                  </span>
                                  <Icon name="arrow" size={16} />
                                  <span>
                                    {slotLabel(project, a.slot)} ·{" "}
                                    {roomName(a.roomId)} ·{" "}
                                    {a.judgeIds.map(judgeName).join(", ")}
                                  </span>
                                </div>
                              );
                            })
                          ) : (
                            <p className="empty-text">
                              {t(
                                "The current plan keeps every previous assignment.",
                                "Текущий план сохраняет все прежние назначения.",
                              )}
                            </p>
                          )}
                          <p className="field-hint preference-note">
                            {t(
                              "Keeping assignments is a search preference. Minimum disruption is not claimed unless the solver proves it.",
                              "Сохранение назначений — предпочтение поиска. Минимальность изменений не заявляется без доказательства.",
                            )}
                          </p>
                        </>
                      ) : (
                        <div className="empty-changes">
                          <Icon name="reset" size={28} />
                          <h3>
                            {t(
                              "Change happens. Stay ready.",
                              "Изменения случаются. Будьте готовы.",
                            )}
                          </h3>
                          <p>
                            {t(
                              "Generate a schedule, simulate a judge outage, then replan. Compare exactly what moved here.",
                              "Сгенерируйте расписание, отметьте недоступность судьи и перепланируйте. Здесь будет точное сравнение.",
                            )}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="grid-footer">
                    <span>
                      <span className="legend-dot" />
                      {t("Scheduled", "Запланировано")}
                    </span>
                    <span>
                      <Icon name="lock" size={12} />
                      {project.locks.length} {t("locked", "закреплено")}
                    </span>
                    {changes.length > 0 && (
                      <span>
                        <span className="legend-dot changed-dot" />
                        {changes.length} {t("changed", "изменено")}
                      </span>
                    )}
                    <button
                      className="text-button no-print"
                      disabled={!ready}
                      onClick={exportCalendar}
                    >
                      <Icon name="download" size={13} />
                      {t("Export calendar", "Экспорт календаря")}
                    </button>
                  </div>
                </section>

                <aside className="operations-aside no-print">
                  <section className="day-brief">
                    <div className="aside-heading">
                      <span className="eyebrow">
                        {t("THE DAY AT A GLANCE", "ОБЗОР ДНЯ")}
                      </span>
                      <Icon name="spark" size={15} />
                    </div>
                    <h2>
                      {t(
                        "Good plans account for everyone.",
                        "Хороший план учитывает всех.",
                      )}
                    </h2>
                    <ul className="constraint-checks">
                      <li>
                        <Icon name="check" size={14} />
                        <span>
                          {t(
                            "No room or judge overlaps",
                            "Без накладок залов и судей",
                          )}
                        </span>
                      </li>
                      <li>
                        <Icon name="check" size={14} />
                        <span>
                          {t("Availability respected", "Доступность учтена")}
                        </span>
                      </li>
                      <li>
                        <Icon name="check" size={14} />
                        <span>
                          {t(
                            "Required judges included",
                            "Обязательные судьи учтены",
                          )}
                        </span>
                      </li>
                      <li>
                        <Icon name="check" size={14} />
                        <span>
                          {t(
                            "Conflicts of interest avoided",
                            "Без конфликтов интересов",
                          )}
                        </span>
                      </li>
                      <li>
                        <Icon name="lock" size={13} />
                        <span>
                          {t(
                            "Locked assignments stay put",
                            "Закрепления сохраняются",
                          )}
                        </span>
                      </li>
                    </ul>
                    <div className="proof-note">
                      {ready ? (
                        <>
                          <span className="tiny-signal" />
                          {t(
                            "Validated against all hard constraints",
                            "Проверено по всем строгим ограничениям",
                          )}
                        </>
                      ) : (
                        <>
                          {t(
                            "These rules are checked on every generated schedule.",
                            "Эти правила проверяются для каждого результата.",
                          )}
                        </>
                      )}
                    </div>
                  </section>
                  <section className="jury-availability">
                    <div className="aside-heading">
                      <span className="eyebrow">
                        {t("JURY AVAILABILITY", "ДОСТУПНОСТЬ ЖЮРИ")}
                      </span>
                      <button
                        className="text-button"
                        onClick={() => setView("judges")}
                      >
                        {t("Edit", "Править")} ↗
                      </button>
                    </div>
                    {project.judges.map((j, i) => (
                      <div className="jury-mini" key={j.id}>
                        <span className={`jury-portrait portrait-${i % 3}`}>
                          {initials(j.name)}
                        </span>
                        <div>
                          <strong>{j.name}</strong>
                          <div
                            className="availability-ticks"
                            aria-label={t(
                              `${j.availableSlots.length} of ${project.slotCount} slots available`,
                              `Доступно слотов: ${j.availableSlots.length} из ${project.slotCount}`,
                            )}
                          >
                            {slots.map((s) => (
                              <i
                                key={s}
                                title={slotLabel(project, s)}
                                className={
                                  j.availableSlots.includes(s)
                                    ? "available"
                                    : ""
                                }
                              />
                            ))}
                          </div>
                        </div>
                        <span>
                          {j.availableSlots.length}/{project.slotCount}
                        </span>
                      </div>
                    ))}
                    <div className="availability-caption">
                      <span>{project.startTime}</span>
                      <span>
                        {slotLabel(project, Math.max(0, project.slotCount - 1))}{" "}
                        UTC
                      </span>
                    </div>
                  </section>
                  <section className="disruption-panel">
                    <div className="disruption-tag">
                      <Icon name="alert" size={13} />
                      {t("THE REAL-LIFE TEST", "ПРОВЕРКА ЖИЗНЬЮ")}
                    </div>
                    <h3>
                      {t(
                        "A judge calls. Plans change.",
                        "Судья звонит. Планы меняются.",
                      )}
                    </h3>
                    <p>
                      {t(
                        "Take a judge offline and rebuild the day, with a preference for keeping everyone else in place.",
                        "Уберите судью и соберите день заново, стараясь сохранить остальные назначения.",
                      )}
                    </p>
                    {showOutage && (
                      <div className="outage-fields">
                        <label>
                          {t("Judge", "Судья")}
                          <select
                            value={effectiveOutageJudge}
                            onChange={(e) => setOutageJudge(e.target.value)}
                            aria-label={t("Judge", "Судья")}
                          >
                            {project.judges.map((j) => (
                              <option key={j.id} value={j.id}>
                                {j.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          {t("Unavailable from", "Недоступен с")}
                          <select
                            value={effectiveOutageSlot}
                            onChange={(e) =>
                              setOutageSlot(Number(e.target.value))
                            }
                            aria-label={t("Unavailable from", "Недоступен с")}
                          >
                            {slots.map((s) => (
                              <option key={s} value={s}>
                                {slotLabel(project, s)} UTC
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    )}
                    <button
                      className="button outage-button"
                      disabled={!ready || busy || !project.judges.length}
                      onClick={() =>
                        showOutage ? simulateOutage() : setShowOutage(true)
                      }
                    >
                      <Icon name="reset" size={15} />
                      {showOutage
                        ? t("Confirm judge outage", "Подтвердить недоступность")
                        : t("Simulate judge outage", "Судья недоступен")}
                      <Icon name="arrow" size={15} />
                    </button>
                    <span className="disruption-hint">
                      {t(
                        "Generate → disrupt → replan → compare",
                        "Сгенерируйте → измените → сравните",
                      )}
                    </span>
                  </section>
                </aside>
              </div>
            </>
          )}

          {view === "teams" && (
            <section className="editor-section">
              <div className="editor-toolbar">
                <div>
                  <h2>{t("The next big ideas", "Следующие большие идеи")}</h2>
                  <p>
                    {t(
                      "Each team gets one fixed-length pitch. Fine-tune its constraints.",
                      "Каждая команда получает один слот. Настройте её ограничения.",
                    )}
                  </p>
                </div>
                <button
                  className="button primary"
                  disabled={busy || project.teams.length >= 60}
                  onClick={() =>
                    updateProject((p) => ({
                      ...p,
                      teams: [
                        ...p.teams,
                        {
                          id: `team-${crypto.randomUUID()}`,
                          name: t("New team", "Новая команда"),
                          track: "Open track",
                          availableSlots: slots,
                          requiredJudgeIds: [],
                          excludedJudgeIds: [],
                          judgeCount: 1,
                        },
                      ],
                    }))
                  }
                >
                  <Icon name="plus" size={16} />
                  {t("Add team", "Добавить команду")}
                </button>
              </div>
              <div className="team-table">
                <div className="team-table-head">
                  <span>#</span>
                  <span>{t("TEAM / PROJECT", "КОМАНДА / ПРОЕКТ")}</span>
                  <span>{t("TRACK", "ТРЕК")}</span>
                  <span>{t("RULES", "ПРАВИЛА")}</span>
                  <span />
                </div>
                {project.teams.map((item, i) => (
                  <div className="team-table-row" key={item.id}>
                    <span className="row-number">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <label>
                      <span className="visually-hidden">
                        {t(`Team name ${i + 1}`, `Название команды ${i + 1}`)}
                      </span>
                      <input
                        aria-label={t(
                          `Team name ${i + 1}`,
                          `Название команды ${i + 1}`,
                        )}
                        value={item.name}
                        maxLength={100}
                        onChange={(e) =>
                          updateTeam(item.id, { name: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span className="visually-hidden">
                        {t(
                          `Track for ${item.name}`,
                          `Трек команды ${item.name}`,
                        )}
                      </span>
                      <input
                        value={item.track}
                        maxLength={80}
                        onChange={(e) =>
                          updateTeam(item.id, { track: e.target.value })
                        }
                      />
                    </label>
                    <button
                      className="constraint-button"
                      onClick={() => setDetailTeam(item.id)}
                    >
                      <span>
                        {item.requiredJudgeIds.length +
                          item.excludedJudgeIds.length +
                          (item.availableSlots.length !== project.slotCount
                            ? 1
                            : 0)}
                      </span>
                      {t("constraints", "ограничений")}
                      <span className="visually-hidden">
                        {t(` for ${item.name}`, ` команды ${item.name}`)}
                      </span>
                      <Icon name="chevron" size={13} />
                    </button>
                    <button
                      className="icon-button delete-button"
                      aria-label={t(
                        `Delete team ${item.name}`,
                        `Удалить команду ${item.name}`,
                      )}
                      onClick={() =>
                        updateProject((p) => ({
                          ...p,
                          teams: p.teams.filter((x) => x.id !== item.id),
                          locks: p.locks.filter((a) => a.teamId !== item.id),
                        }))
                      }
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                ))}
              </div>
              {!project.teams.length && (
                <div className="editor-empty">
                  <Icon name="people" size={30} />
                  <h3>{t("Who’s pitching?", "Кто выступает?")}</h3>
                  <p>
                    {t(
                      "Add the first team to start shaping the day.",
                      "Добавьте первую команду для начала.",
                    )}
                  </p>
                </div>
              )}
            </section>
          )}

          {view === "judges" && (
            <section className="editor-section">
              <div className="editor-toolbar">
                <div>
                  <h2>{t("A thoughtful jury", "Внимательное жюри")}</h2>
                  <p>
                    {t(
                      "Choose when each judge is available. Amber gaps are unavailable.",
                      "Укажите доступность каждого судьи. Пропуски означают недоступность.",
                    )}
                  </p>
                </div>
                <button
                  className="button primary"
                  disabled={busy || project.judges.length >= 12}
                  onClick={() =>
                    updateProject((p) => ({
                      ...p,
                      judges: [
                        ...p.judges,
                        {
                          id: `judge-${crypto.randomUUID()}`,
                          name: t("New judge", "Новый судья"),
                          expertise: "General",
                          availableSlots: slots,
                        },
                      ],
                    }))
                  }
                >
                  <Icon name="plus" size={16} />
                  {t("Add judge", "Добавить судью")}
                </button>
              </div>
              <div className="resource-list">
                {project.judges.map((j, i) => (
                  <article key={j.id} className="resource-row">
                    <div className="resource-identity">
                      <span className={`jury-portrait large portrait-${i % 3}`}>
                        {initials(j.name)}
                      </span>
                      <label>
                        {t("Name", "Имя")}
                        <input
                          aria-label={t(
                            `Judge name ${i + 1}`,
                            `Имя судьи ${i + 1}`,
                          )}
                          maxLength={100}
                          value={j.name}
                          onChange={(e) =>
                            updateProject((p) => ({
                              ...p,
                              judges: p.judges.map((x) =>
                                x.id === j.id
                                  ? { ...x, name: e.target.value }
                                  : x,
                              ),
                            }))
                          }
                        />
                      </label>
                      <label>
                        {t("Expertise", "Экспертиза")}
                        <input
                          maxLength={100}
                          aria-label={t(
                            `Expertise for ${j.name}`,
                            `Экспертиза судьи ${j.name}`,
                          )}
                          value={j.expertise}
                          onChange={(e) =>
                            updateProject((p) => ({
                              ...p,
                              judges: p.judges.map((x) =>
                                x.id === j.id
                                  ? { ...x, expertise: e.target.value }
                                  : x,
                              ),
                            }))
                          }
                        />
                      </label>
                      <button
                        className="icon-button delete-button"
                        aria-label={t(
                          `Delete judge ${j.name}`,
                          `Удалить судью ${j.name}`,
                        )}
                        onClick={() =>
                          updateProject((p) => ({
                            ...p,
                            judges: p.judges.filter((x) => x.id !== j.id),
                            teams: p.teams.map((x) => ({
                              ...x,
                              requiredJudgeIds: x.requiredJudgeIds.filter(
                                (id) => id !== j.id,
                              ),
                              excludedJudgeIds: x.excludedJudgeIds.filter(
                                (id) => id !== j.id,
                              ),
                            })),
                            locks: p.locks.filter(
                              (a) => !a.judgeIds.includes(j.id),
                            ),
                          }))
                        }
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                    <SlotPicker
                      project={project}
                      value={j.availableSlots}
                      language={language}
                      label={t("Available pitch slots", "Доступные слоты")}
                      onChange={(availableSlots) =>
                        updateProject((p) => ({
                          ...p,
                          judges: p.judges.map((x) =>
                            x.id === j.id ? { ...x, availableSlots } : x,
                          ),
                        }))
                      }
                    />
                  </article>
                ))}
              </div>
              {!project.judges.length && (
                <div className="editor-empty">
                  <h3>
                    {t(
                      "Every idea needs a listener.",
                      "Каждой идее нужен слушатель.",
                    )}
                  </h3>
                  <p>
                    {t(
                      "Add a judge to make scheduling possible.",
                      "Добавьте судью для планирования.",
                    )}
                  </p>
                </div>
              )}
            </section>
          )}

          {view === "rooms" && (
            <section className="editor-section">
              <div className="editor-toolbar">
                <div>
                  <h2>
                    {t("Make room for the moment", "Место для важных моментов")}
                  </h2>
                  <p>
                    {t(
                      "One team per room, per slot. Set room-specific availability below.",
                      "Одна команда в зале на слот. Настройте доступность залов.",
                    )}
                  </p>
                </div>
                <button
                  className="button primary"
                  disabled={busy || project.rooms.length >= 8}
                  onClick={() =>
                    updateProject((p) => ({
                      ...p,
                      rooms: [
                        ...p.rooms,
                        {
                          id: `room-${crypto.randomUUID()}`,
                          name: t("New room", "Новый зал"),
                          availableSlots: slots,
                        },
                      ],
                    }))
                  }
                >
                  <Icon name="plus" size={16} />
                  {t("Add room", "Добавить зал")}
                </button>
              </div>
              <div className="resource-list">
                {project.rooms.map((room, i) => (
                  <article className="resource-row" key={room.id}>
                    <div className="resource-identity">
                      <span className="room-number">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <label>
                        {t("Room name", "Название зала")}
                        <input
                          aria-label={t(
                            `Room name ${i + 1}`,
                            `Название аудитории ${i + 1}`,
                          )}
                          maxLength={100}
                          value={room.name}
                          onChange={(e) =>
                            updateProject((p) => ({
                              ...p,
                              rooms: p.rooms.map((x) =>
                                x.id === room.id
                                  ? { ...x, name: e.target.value }
                                  : x,
                              ),
                            }))
                          }
                        />
                      </label>
                      <button
                        className="icon-button delete-button"
                        aria-label={t(
                          `Delete room ${room.name}`,
                          `Удалить аудиторию ${room.name}`,
                        )}
                        onClick={() =>
                          updateProject((p) => ({
                            ...p,
                            rooms: p.rooms.filter((x) => x.id !== room.id),
                            locks: p.locks.filter((a) => a.roomId !== room.id),
                          }))
                        }
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                    <SlotPicker
                      project={project}
                      value={room.availableSlots}
                      language={language}
                      label={t("Available pitch slots", "Доступные слоты")}
                      onChange={(availableSlots) =>
                        updateProject((p) => ({
                          ...p,
                          rooms: p.rooms.map((x) =>
                            x.id === room.id ? { ...x, availableSlots } : x,
                          ),
                        }))
                      }
                    />
                  </article>
                ))}
              </div>
              {!project.rooms.length && (
                <div className="editor-empty">
                  <h3>
                    {t(
                      "Find a place to pitch.",
                      "Найдите место для выступлений.",
                    )}
                  </h3>
                  <p>
                    {t(
                      "Add at least one room to create a schedule.",
                      "Добавьте хотя бы один зал.",
                    )}
                  </p>
                </div>
              )}
            </section>
          )}

          {view === "settings" && (
            <section className="editor-section settings-section">
              <div className="editor-toolbar">
                <div>
                  <h2>{t("Set the rhythm", "Задайте ритм")}</h2>
                  <p>
                    {t(
                      "Times use UTC for predictable imports and calendar exports.",
                      "Время в UTC для однозначного импорта и экспорта календаря.",
                    )}
                  </p>
                </div>
                <Icon name="clock" size={25} />
              </div>
              <div className="settings-form">
                <label className="wide-field">
                  {t("Event name", "Название события")}
                  <input
                    aria-label={t("Event name", "Название события")}
                    maxLength={120}
                    value={project.name}
                    onChange={(e) =>
                      updateProject((p) => ({ ...p, name: e.target.value }))
                    }
                  />
                </label>
                <label>
                  {t("Date", "Дата")}
                  <input
                    type="date"
                    aria-label={t("Event date", "Дата события")}
                    value={project.date}
                    onChange={(e) =>
                      updateProject((p) => ({ ...p, date: e.target.value }))
                    }
                  />
                </label>
                <label>
                  {t("First pitch (UTC)", "Первый питч (UTC)")}
                  <input
                    type="time"
                    aria-label={t("Start time", "Время начала")}
                    value={project.startTime}
                    onChange={(e) =>
                      updateProject((p) => ({
                        ...p,
                        startTime: e.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  {t("Minutes per pitch", "Минут на выступление")}
                  <NumericField
                    min={5}
                    max={120}
                    label={t("Minutes per pitch", "Минут на выступление")}
                    language={language}
                    onDraftChange={() => {
                      importSequence.current++;
                    }}
                    value={project.slotMinutes}
                    onCommit={(minutes) =>
                      updateProject((p) => ({
                        ...p,
                        slotMinutes: minutes,
                      }))
                    }
                  />
                </label>
                <label>
                  {t("Number of slots", "Количество слотов")}
                  <NumericField
                    min={1}
                    max={32}
                    label={t("Number of slots", "Количество слотов")}
                    language={language}
                    onDraftChange={() => {
                      importSequence.current++;
                    }}
                    value={project.slotCount}
                    onCommit={(count) => {
                      updateProject((p) => {
                        const fit = (a: number[]) => [
                          ...a.filter((s) => s < count),
                          ...Array.from(
                            { length: Math.max(0, count - p.slotCount) },
                            (_, i) => p.slotCount + i,
                          ),
                        ];
                        return {
                          ...p,
                          slotCount: count,
                          teams: p.teams.map((x) => ({
                            ...x,
                            availableSlots: fit(x.availableSlots),
                          })),
                          judges: p.judges.map((x) => ({
                            ...x,
                            availableSlots: fit(x.availableSlots),
                          })),
                          rooms: p.rooms.map((x) => ({
                            ...x,
                            availableSlots: fit(x.availableSlots),
                          })),
                          locks: p.locks.filter((a) => a.slot < count),
                        };
                      });
                    }}
                  />
                </label>
              </div>
              <div className="settings-note">
                <Icon name="lock" size={20} />
                <div>
                  <strong>
                    {t(
                      "Your workspace stays yours.",
                      "Ваша рабочая область остаётся вашей.",
                    )}
                  </strong>
                  <p>
                    {t(
                      "Saved in this browser, on this device. Export JSON to keep a backup or move to another computer. No accounts, no server, no tracking.",
                      "Сохранено в этом браузере на этом устройстве. Экспортируйте JSON для резервной копии или переноса. Без аккаунтов, серверов и отслеживания.",
                    )}
                  </p>
                </div>
              </div>
            </section>
          )}

          <footer className="workspace-footer">
            <span>
              JURYFLOW<span> / </span>
              {t(
                "Less logistics. More possibility.",
                "Меньше логистики. Больше возможностей.",
              )}
            </span>
            <button className="text-button no-print" onClick={reset}>
              <Icon name="reset" size={13} />
              {t("Reset demo", "Сбросить демо")}
            </button>
          </footer>
        </main>
      </div>

      {team && (
        <Dialog
          title={team.name}
          language={language}
          onClose={() => setDetailTeam(null)}
        >
          {assignment && ready && (
            <div className="assignment-detail">
              <div>
                <span className="eyebrow">
                  {t("CURRENT ASSIGNMENT", "ТЕКУЩЕЕ НАЗНАЧЕНИЕ")}
                </span>
                <strong>
                  {slotLabel(project, assignment.slot)} UTC <span>·</span>{" "}
                  {roomName(assignment.roomId)}
                </strong>
                <p>{assignment.judgeIds.map(judgeName).join(" / ")}</p>
              </div>
              <label className="lock-toggle">
                <input
                  type="checkbox"
                  checked={locked(team.id)}
                  onChange={(e) => setLock(assignment, e.target.checked)}
                  aria-label={t("Lock assignment", "Закрепить назначение")}
                />
                <Icon name="lock" size={16} />
                {t("Lock assignment", "Закрепить назначение")}
              </label>
            </div>
          )}
          {locked(team.id) && !assignment && (
            <div className="message">
              <Icon name="lock" size={15} />
              <span>
                {t(
                  "This team has a locked assignment.",
                  "У команды есть закрепление.",
                )}
              </span>
              <button
                className="text-button"
                onClick={() =>
                  setDocument((current) => ({
                    ...current,
                    project: {
                      ...current.project,
                      locks: current.project.locks.filter(
                        (a) => a.teamId !== team.id,
                      ),
                    },
                  }))
                }
              >
                {t("Unlock", "Открепить")}
              </button>
            </div>
          )}
          <div className="team-detail-fields">
            <label>
              {t("Team name", "Название команды")}
              <input
                aria-label={t("Team name", "Название команды")}
                maxLength={100}
                value={team.name}
                onChange={(e) => updateTeam(team.id, { name: e.target.value })}
              />
            </label>
            <label>
              {t("Judges per pitch", "Судей на выступление")}
              <select
                aria-label={t("Judges per pitch", "Судей на выступление")}
                value={team.judgeCount}
                onChange={(e) =>
                  updateTeam(team.id, { judgeCount: Number(e.target.value) })
                }
              >
                {Array.from(
                  { length: Math.max(1, project.judges.length) },
                  (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {i + 1}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
          <SlotPicker
            project={project}
            value={team.availableSlots}
            onChange={(availableSlots) =>
              updateTeam(team.id, { availableSlots })
            }
            label={t("Team availability", "Доступность команды")}
            language={language}
          />
          <fieldset className="judge-rules">
            <legend>{t("Judge requirements", "Требования к судьям")}</legend>
            <p className="field-hint">
              {t(
                "Required judges must attend. Conflicts of interest must never attend.",
                "Обязательные судьи должны присутствовать. Судьи с конфликтом интересов — никогда.",
              )}
            </p>
            <div className="rules-header">
              <span>{t("JUDGE", "СУДЬЯ")}</span>
              <span>{t("REQUIRED", "ОБЯЗАТЕЛЕН")}</span>
              <span>{t("CONFLICT", "КОНФЛИКТ")}</span>
            </div>
            {project.judges.map((j) => (
              <div className="judge-rule-row" key={j.id}>
                <strong>{j.name}</strong>
                <input
                  type="checkbox"
                  aria-label={t(
                    `Require ${j.name}`,
                    `Обязательное участие: ${j.name}`,
                  )}
                  checked={team.requiredJudgeIds.includes(j.id)}
                  onChange={(e) =>
                    updateTeam(team.id, {
                      requiredJudgeIds: e.target.checked
                        ? [...team.requiredJudgeIds, j.id]
                        : team.requiredJudgeIds.filter((id) => id !== j.id),
                    })
                  }
                />
                <input
                  type="checkbox"
                  aria-label={t(
                    `Conflict with ${j.name}`,
                    `Конфликт интересов: ${j.name}`,
                  )}
                  checked={team.excludedJudgeIds.includes(j.id)}
                  onChange={(e) =>
                    updateTeam(team.id, {
                      excludedJudgeIds: e.target.checked
                        ? [...team.excludedJudgeIds, j.id]
                        : team.excludedJudgeIds.filter((id) => id !== j.id),
                    })
                  }
                />
              </div>
            ))}
          </fieldset>
        </Dialog>
      )}
    </div>
  );
}
