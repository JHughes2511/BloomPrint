"""Transactional email: what each event says, in the reader's language.

Built as a shell plus a line rather than twelve whole letters per language.
Every message is the same shape — someone did something, here is what, here is
where to go — so the greeting, the sign-off and the unsubscribe footer are
translated once per language and the events supply a subject and a sentence or
two. Twelve full templates across twenty-five languages would be the same words
copied three hundred times, drifting apart the first time one is edited.

The reader's language comes from their account, the same field the app and the
generated reports already honour. A language we have no copy for falls back to
English rather than failing to send.

Adding an event: add one entry to EVENTS with a subject and body per language.
Adding a language: add one SHELL entry and one line per event. Both are checked
by check_complete() below, which the API runs at startup and logs.
"""
from __future__ import annotations

import os
import re

DEFAULT_LANG = "en"

# Every language the app itself speaks. Kept in step with the locale files in
# mobile/src/i18n/locales and with feedback_emails.py — a coach whose app is in
# Croatian should not get English mail from it.
LANGS = [
    "en", "es", "fr", "pt", "it", "de", "nl", "sv", "pl", "ru", "uk", "sr",
    "hr", "tr", "ro", "el", "lt", "ar", "he", "hi", "ka", "ja", "ko", "zh", "tl",
]


def app_url() -> str:
    """Where a link in an email should send someone."""
    return (os.environ.get("APP_URL") or "https://bloomprint.org").rstrip("/")


def link_to(path: str) -> str:
    """A deep link into the app: app_url() with a path on it.

    Kept here rather than written out at each caller so a change of host, or a
    trailing slash, is one edit and not thirty.
    """
    return f"{app_url()}/{(path or '').lstrip('/')}"


def unsubscribe_url(token: str) -> str:
    """The one-click opt-out. Points at the API, which needs no session to honour it."""
    base = (os.environ.get("API_URL") or app_url()).rstrip("/")
    return f"{base}/unsubscribe?token={token}"


# The frame around every message.
#   greeting:    "Hi {name}," — omitted entirely if we have no name
#   open_cta:    label for the link into the app
#   reset_cta:   label for that link when it is a password-reset link, because
#                a button that says "Open BloomPrint" hides what it does
#   digest_title: subject and heading of the hourly comment digest. No count in
#                it on purpose: "3 new comments" needs plural rules that differ
#                across these twenty-five languages, and the list is right there
#                underneath anyway
#   signoff:     how the message ends
#   unsub:       the footer, with {url} for the opt-out
#   unsub_note:  reassurance that account mail is unaffected by opting out
SHELL: dict[str, dict[str, str]] = {
    "en": {
        "greeting": "Hi {name},",
        "open_cta": "Open BloomPrint",
        "reset_cta": "Choose a new password",
        "digest_title": "New comments and replies",
        "signoff": "BloomPrint",
        "unsub": "Don't want these? Turn them off: {url}",
        "unsub_note": "You'll still get messages about your own account.",
        "contact": "Questions? Email us at",
        "account_ready": "Your account is ready.",
        "unsub_link": "unsubscribe",
    },
    "es": {
        "greeting": "Hola {name}:",
        "open_cta": "Abrir BloomPrint",
        "reset_cta": "Elegir una contraseña nueva",
        "digest_title": "Nuevos comentarios y respuestas",
        "signoff": "BloomPrint",
        "unsub": "¿No quieres recibirlos? Desactívalos: {url}",
        "unsub_note": "Seguirás recibiendo mensajes sobre tu propia cuenta.",
        "contact": "¿Preguntas? Escríbenos a",
        "account_ready": "Tu cuenta está lista.",
        "unsub_link": "darse de baja",
    },
    "fr": {
        "greeting": "Bonjour {name},",
        "open_cta": "Ouvrir BloomPrint",
        "reset_cta": "Choisir un nouveau mot de passe",
        "digest_title": "Nouveaux commentaires et réponses",
        "signoff": "BloomPrint",
        "unsub": "Vous ne voulez plus les recevoir ? Désactivez-les : {url}",
        "unsub_note": "Vous continuerez à recevoir les messages concernant votre compte.",
        "contact": "Des questions ? Écrivez-nous à",
        "account_ready": "Votre compte est prêt.",
        "unsub_link": "se désabonner",
    },
    "pt": {
        "greeting": "Olá {name},",
        "open_cta": "Abrir o BloomPrint",
        "reset_cta": "Escolher uma nova palavra-passe",
        "digest_title": "Novos comentários e respostas",
        "signoff": "BloomPrint",
        "unsub": "Não quer recebê-los? Desative-os: {url}",
        "unsub_note": "Continuará a receber mensagens sobre a sua própria conta.",
        "contact": "Dúvidas? Escreva para",
        "account_ready": "A sua conta está pronta.",
        "unsub_link": "cancelar subscrição",
    },
    "it": {
        "greeting": "Ciao {name},",
        "open_cta": "Apri BloomPrint",
        "reset_cta": "Scegli una nuova password",
        "digest_title": "Nuovi commenti e risposte",
        "signoff": "BloomPrint",
        "unsub": "Non vuoi riceverle? Disattivale: {url}",
        "unsub_note": "Continuerai a ricevere i messaggi relativi al tuo account.",
        "contact": "Domande? Scrivici a",
        "account_ready": "Il tuo account è pronto.",
        "unsub_link": "annulla iscrizione",
    },
    "de": {
        "greeting": "Hallo {name},",
        "open_cta": "BloomPrint öffnen",
        "reset_cta": "Neues Passwort wählen",
        "digest_title": "Neue Kommentare und Antworten",
        "signoff": "BloomPrint",
        "unsub": "Nicht erwünscht? Hier abschalten: {url}",
        "unsub_note": "Nachrichten zu deinem eigenen Konto erhältst du weiterhin.",
        "contact": "Fragen? Schreib uns an",
        "account_ready": "Dein Konto ist bereit.",
        "unsub_link": "abbestellen",
    },
    "nl": {
        "greeting": "Hoi {name},",
        "open_cta": "BloomPrint openen",
        "reset_cta": "Nieuw wachtwoord kiezen",
        "digest_title": "Nieuwe reacties en antwoorden",
        "signoff": "BloomPrint",
        "unsub": "Liever niet? Zet ze uit: {url}",
        "unsub_note": "Berichten over je eigen account blijf je ontvangen.",
        "contact": "Vragen? Mail ons op",
        "account_ready": "Je account is klaar.",
        "unsub_link": "afmelden",
    },
    "sv": {
        "greeting": "Hej {name},",
        "open_cta": "Öppna BloomPrint",
        "reset_cta": "Välj ett nytt lösenord",
        "digest_title": "Nya kommentarer och svar",
        "signoff": "BloomPrint",
        "unsub": "Vill du inte ha dem? Stäng av dem: {url}",
        "unsub_note": "Du får fortfarande meddelanden som rör ditt eget konto.",
        "contact": "Frågor? Mejla oss på",
        "account_ready": "Ditt konto är klart.",
        "unsub_link": "avsluta prenumeration",
    },
    "pl": {
        "greeting": "Cześć {name},",
        "open_cta": "Otwórz BloomPrint",
        "reset_cta": "Ustaw nowe hasło",
        "digest_title": "Nowe komentarze i odpowiedzi",
        "signoff": "BloomPrint",
        "unsub": "Nie chcesz ich otrzymywać? Wyłącz je: {url}",
        "unsub_note": "Wiadomości dotyczące Twojego konta będziesz otrzymywać nadal.",
        "contact": "Pytania? Napisz do nas na",
        "account_ready": "Twoje konto jest gotowe.",
        "unsub_link": "zrezygnuj",
    },
    "ru": {
        "greeting": "Здравствуйте, {name}!",
        "open_cta": "Открыть BloomPrint",
        "reset_cta": "Задать новый пароль",
        "digest_title": "Новые комментарии и ответы",
        "signoff": "BloomPrint",
        "unsub": "Не хотите их получать? Отключите: {url}",
        "unsub_note": "Сообщения о вашей учётной записи будут приходить по-прежнему.",
        "contact": "Вопросы? Напишите нам на",
        "account_ready": "Ваш аккаунт готов.",
        "unsub_link": "отписаться",
    },
    "uk": {
        "greeting": "Вітаємо, {name}!",
        "open_cta": "Відкрити BloomPrint",
        "reset_cta": "Задати новий пароль",
        "digest_title": "Нові коментарі та відповіді",
        "signoff": "BloomPrint",
        "unsub": "Не хочете їх отримувати? Вимкніть: {url}",
        "unsub_note": "Повідомлення про ваш обліковий запис надходитимуть і далі.",
        "contact": "Питання? Напишіть нам на",
        "account_ready": "Ваш обліковий запис готовий.",
        "unsub_link": "відписатися",
    },
    "sr": {
        "greeting": "Здраво {name},",
        "open_cta": "Отвори BloomPrint",
        "reset_cta": "Изаберите нову лозинку",
        "digest_title": "Нови коментари и одговори",
        "signoff": "BloomPrint",
        "unsub": "Не желите ово? Искључите: {url}",
        "unsub_note": "Поруке о вашем налогу и даље ћете примати.",
        "contact": "Питања? Пишите нам на",
        "account_ready": "Ваш налог је спреман.",
        "unsub_link": "одјави се",
    },
    "hr": {
        "greeting": "Bok {name},",
        "open_cta": "Otvori BloomPrint",
        "reset_cta": "Odaberite novu lozinku",
        "digest_title": "Novi komentari i odgovori",
        "signoff": "BloomPrint",
        "unsub": "Ne želite ovo? Isključite: {url}",
        "unsub_note": "Poruke o vašem računu i dalje ćete primati.",
        "contact": "Pitanja? Pišite nam na",
        "account_ready": "Vaš račun je spreman.",
        "unsub_link": "odjavi se",
    },
    "tr": {
        "greeting": "Merhaba {name},",
        "open_cta": "BloomPrint'i aç",
        "reset_cta": "Yeni şifre belirle",
        "digest_title": "Yeni yorumlar ve yanıtlar",
        "signoff": "BloomPrint",
        "unsub": "Bunları istemiyor musunuz? Kapatın: {url}",
        "unsub_note": "Kendi hesabınızla ilgili mesajları almaya devam edeceksiniz.",
        "contact": "Sorunuz mu var? Bize yazın:",
        "account_ready": "Hesabınız hazır.",
        "unsub_link": "aboneliği bırak",
    },
    "ro": {
        "greeting": "Salut {name},",
        "open_cta": "Deschide BloomPrint",
        "reset_cta": "Alege o parolă nouă",
        "digest_title": "Comentarii și răspunsuri noi",
        "signoff": "BloomPrint",
        "unsub": "Nu le vrei? Dezactivează-le: {url}",
        "unsub_note": "Vei primi în continuare mesajele despre contul tău.",
        "contact": "Întrebări? Scrie-ne la",
        "account_ready": "Contul tău este gata.",
        "unsub_link": "dezabonare",
    },
    "el": {
        "greeting": "Γεια σου {name},",
        "open_cta": "Άνοιγμα του BloomPrint",
        "reset_cta": "Επιλογή νέου κωδικού",
        "digest_title": "Νέα σχόλια και απαντήσεις",
        "signoff": "BloomPrint",
        "unsub": "Δεν τα θέλετε; Απενεργοποιήστε τα: {url}",
        "unsub_note": "Θα συνεχίσετε να λαμβάνετε μηνύματα για τον λογαριασμό σας.",
        "contact": "Απορίες; Γράψτε μας στο",
        "account_ready": "Ο λογαριασμός σας είναι έτοιμος.",
        "unsub_link": "κατάργηση εγγραφής",
    },
    "lt": {
        "greeting": "Sveiki, {name},",
        "open_cta": "Atidaryti BloomPrint",
        "reset_cta": "Nustatyti naują slaptažodį",
        "digest_title": "Nauji komentarai ir atsakymai",
        "signoff": "BloomPrint",
        "unsub": "Nenorite jų gauti? Išjunkite: {url}",
        "unsub_note": "Pranešimus apie savo paskyrą ir toliau gausite.",
        "contact": "Klausimai? Rašykite mums adresu",
        "account_ready": "Jūsų paskyra paruošta.",
        "unsub_link": "atsisakyti",
    },
    "ar": {
        "greeting": "مرحبًا {name}،",
        "open_cta": "فتح BloomPrint",
        "reset_cta": "اختيار كلمة مرور جديدة",
        "digest_title": "تعليقات وردود جديدة",
        "signoff": "BloomPrint",
        "unsub": "لا تريد هذه الرسائل؟ أوقفها: {url}",
        "unsub_note": "ستستمر في تلقّي الرسائل المتعلقة بحسابك.",
        "contact": "أسئلة؟ راسلنا على",
        "account_ready": "حسابك جاهز.",
        "unsub_link": "إلغاء الاشتراك",
    },
    "he": {
        "greeting": "שלום {name},",
        "open_cta": "פתיחת BloomPrint",
        "reset_cta": "בחירת סיסמה חדשה",
        "digest_title": "תגובות ותשובות חדשות",
        "signoff": "BloomPrint",
        "unsub": "לא מעוניין בהודעות האלה? אפשר לכבות: {url}",
        "unsub_note": "הודעות שנוגעות לחשבון שלך ימשיכו להישלח.",
        "contact": "שאלות? כתבו לנו אל",
        "account_ready": "החשבון שלך מוכן.",
        "unsub_link": "ביטול הרשמה",
    },
    "hi": {
        "greeting": "नमस्ते {name},",
        "open_cta": "BloomPrint खोलें",
        "reset_cta": "नया पासवर्ड चुनें",
        "digest_title": "नई टिप्पणियाँ और जवाब",
        "signoff": "BloomPrint",
        "unsub": "ये नहीं चाहिए? इन्हें बंद करें: {url}",
        "unsub_note": "आपके अपने खाते से जुड़े संदेश आपको मिलते रहेंगे।",
        "contact": "सवाल? हमें यहाँ लिखें",
        "account_ready": "आपका खाता तैयार है।",
        "unsub_link": "सदस्यता समाप्त करें",
    },
    "ka": {
        "greeting": "გამარჯობა, {name},",
        "open_cta": "BloomPrint-ის გახსნა",
        "reset_cta": "ახალი პაროლის არჩევა",
        "digest_title": "ახალი კომენტარები და პასუხები",
        "signoff": "BloomPrint",
        "unsub": "აღარ გსურთ მათი მიღება? გამორთეთ: {url}",
        "unsub_note": "თქვენს ანგარიშთან დაკავშირებულ შეტყობინებებს კვლავ მიიღებთ.",
        "contact": "შეკითხვები? მოგვწერეთ",
        "account_ready": "თქვენი ანგარიში მზადაა.",
        "unsub_link": "გამოწერის გაუქმება",
    },
    "ja": {
        "greeting": "{name} さん",
        "open_cta": "BloomPrint を開く",
        "reset_cta": "新しいパスワードを設定",
        "digest_title": "新しいコメントと返信",
        "signoff": "BloomPrint",
        "unsub": "不要な場合はこちらから停止できます: {url}",
        "unsub_note": "アカウントに関するお知らせは引き続きお送りします。",
        "contact": "ご質問は",
        "account_ready": "アカウントの準備ができました。",
        "unsub_link": "配信停止",
    },
    "ko": {
        "greeting": "{name}님, 안녕하세요.",
        "open_cta": "BloomPrint 열기",
        "reset_cta": "새 비밀번호 설정",
        "digest_title": "새 댓글과 답글",
        "signoff": "BloomPrint",
        "unsub": "받고 싶지 않으신가요? 여기에서 끄세요: {url}",
        "unsub_note": "계정 관련 안내는 계속 발송됩니다.",
        "contact": "문의는",
        "account_ready": "계정이 준비되었습니다.",
        "unsub_link": "수신 거부",
    },
    "zh": {
        "greeting": "{name} 你好，",
        "open_cta": "打开 BloomPrint",
        "reset_cta": "设置新密码",
        "digest_title": "新的评论和回复",
        "signoff": "BloomPrint",
        "unsub": "不想收到这些邮件？可在此关闭：{url}",
        "unsub_note": "与你账号相关的邮件仍会照常发送。",
        "contact": "有问题？请发邮件至",
        "account_ready": "你的账户已就绪。",
        "unsub_link": "退订",
    },
    "tl": {
        "greeting": "Kumusta {name},",
        "open_cta": "Buksan ang BloomPrint",
        "reset_cta": "Pumili ng bagong password",
        "digest_title": "Mga bagong komento at sagot",
        "signoff": "BloomPrint",
        "unsub": "Ayaw mo ng mga ito? I-off sila: {url}",
        "unsub_note": "Patuloy mo pa ring matatanggap ang mga mensahe tungkol sa sarili mong account.",
        "contact": "May tanong? Mag-email sa",
        "account_ready": "Handa na ang iyong account.",
        "unsub_link": "mag-unsubscribe",
    },
}

# Which events exist, and whether opting out silences them.
#
# Account mail is transactional: someone asked for it by signing up or by
# changing their address, and suppressing it would leave them unable to use
# what they asked for. Activity mail is about other people's actions, and that
# is what the opt-out is for.
ACCOUNT_EVENTS = {"signup_coach", "signup_player", "email_changed",
                  # A reset link and the notice that a password changed are
                  # the two messages someone locked out of an account needs
                  # most. An opt-out must never be able to hold them back.
                  "password_reset", "password_changed"}


class _Missing(dict):
    """Leave an unknown placeholder visible rather than raising mid-send.

    A template referring to a param a caller forgot should degrade to a slightly
    odd sentence, not an exception that costs someone their notification.
    """
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


def _fmt(s: str, params: dict) -> str:
    try:
        return s.format_map(_Missing(params))
    except Exception:
        return s


def _plain(s: str) -> str:
    """The body as text, with the emphasis markers taken out.

    A name is marked **like this** in the copy so the laid-out version can bold
    it. The text version has no way to draw bold, and leaving the markers in
    means a reader on a text-only client sees the asterisks — which is worse
    than no emphasis at all, because it reads as a formatting bug.
    """
    return re.sub(r"\*\*(.+?)\*\*", r"\1", s or "")


# Events that earn the banner. Everything else is the plain layout: a
# notification wearing a celebration reads as marketing, and a sender that
# celebrates a comment teaches people to skim the message that mattered.
MILESTONE_EVENTS = {"signup_coach", "signup_player"}


def _cta(shell: dict[str, str], event: str) -> str:
    """What the one link in the message should be called.

    Nearly every message is asking someone to come and look at something, so
    the default says so. A reset link is the exception: it does one specific
    thing, and a button labelled "Open BloomPrint" on a mail about a password
    is the kind of button people do not press because they cannot tell what it
    will do.
    """
    if event == "password_reset":
        return shell.get("reset_cta") or shell["open_cta"]
    return shell["open_cta"]


def render(event: str, lang: str | None, params: dict | None = None, *,
           token: str | None = None, link: str | None = None) -> tuple[str, str]:
    """(subject, body) for one event, in the reader's language.

    An unknown language falls back to English: sending in the wrong language
    beats not sending. An unknown event is a programming error and raises.
    """
    from .email_events import EVENTS

    if event not in EVENTS:
        raise KeyError(f"No email copy for event {event!r}")

    params = dict(params or {})
    code = (lang or DEFAULT_LANG).split("-")[0].lower()
    if code not in EVENTS[event]:
        code = DEFAULT_LANG
    shell = SHELL.get(code, SHELL[DEFAULT_LANG])

    subject, line = EVENTS[event][code]
    subject = _fmt(subject, params)

    parts: list[str] = []
    name = (params.get("name") or "").strip()
    if name:
        parts.append(_fmt(shell["greeting"], {"name": name}))
    parts.append(_plain(_fmt(line, params)))
    parts.append(f"{_cta(shell, event)}: {link or app_url()}")
    parts.append(shell["signoff"])

    # Account mail carries no opt-out: it is the consequence of something the
    # recipient did themselves, and there is nothing to unsubscribe from.
    if token and event not in ACCOUNT_EVENTS:
        parts.append(
            _fmt(shell["unsub"], {"url": unsubscribe_url(token)})
            + "\n" + shell["unsub_note"]
        )

    return subject, "\n\n".join(parts) + "\n"


def check_complete() -> list[str]:
    """Every event translated into every language, and every shell key present.

    Returned rather than raised so the caller decides whether a gap is fatal.
    A missing translation is invisible at runtime — it silently becomes English
    — so it has to be caught by something that looks on purpose.
    """
    from .email_events import EVENTS

    problems: list[str] = []
    shell_keys = set(SHELL[DEFAULT_LANG])
    for lang in LANGS:
        if lang not in SHELL:
            problems.append(f"SHELL missing language {lang!r}")
            continue
        for key in shell_keys - set(SHELL[lang]):
            problems.append(f"SHELL[{lang!r}] missing key {key!r}")
    for event, by_lang in EVENTS.items():
        for lang in LANGS:
            if lang not in by_lang:
                problems.append(f"EVENTS[{event!r}] missing language {lang!r}")
    return problems


def render_html(event: str, lang: str | None, params: dict | None = None, *,
                token: str | None = None, link: str | None = None) -> str:
    """The same message, laid out.

    Deliberately assembled from the same shell and the same event line as the
    text version rather than from a second copy of the words. Two renderings of
    one message are a pair that drifts; one set of words rendered twice is not.
    """
    from .email_events import EVENTS
    from .email_html import ACCENT, INK, build
    from .mailer import contact_email

    code = (lang or DEFAULT_LANG).split("-")[0].lower()
    if event not in EVENTS or code not in EVENTS[event]:
        code = DEFAULT_LANG
    shell = SHELL.get(code, SHELL[DEFAULT_LANG])
    params = dict(params or {})
    _, line = EVENTS[event][code]

    name = (params.get("name") or "").strip()
    greeting = _fmt(shell["greeting"], {"name": name}) if name else None

    kw: dict = {
        "body": _fmt(line, params),
        "lang": code,
        "cta_label": _cta(shell, event),
        "cta_url": link or app_url(),
        "contact": shell.get("contact"),
        "contact_address": contact_email(),
    }
    if event in MILESTONE_EVENTS:
        # The banner carries the news, so the greeting moves onto it as the
        # kicker rather than being said twice.
        kw["headline"] = shell.get("account_ready", "Your account is ready.")
        kw["kicker"] = greeting
        kw["banner_bg"] = ACCENT
        kw["banner_fg"] = "#FFFFFF"
        kw["banner_kicker_fg"] = "#CFE3EE"
        kw["cta_bg"] = INK
    else:
        kw["greeting"] = greeting

    # Account mail carries no opt-out: it is the consequence of something the
    # recipient did themselves.
    if token and event not in ACCOUNT_EVENTS:
        # The text shell writes one sentence with the URL inside it. HTML needs
        # the words and the address apart, so the sentence is kept without its
        # placeholder and the link carries its own short label.
        kw["unsub"] = shell["unsub"].replace("{url}", "").strip()
        kw["unsub_url"] = unsubscribe_url(token)
        kw["unsub_label"] = shell["unsub_link"]
    return build(**kw)


# ── Notifications, as email ───────────────────────────────────────────────────
#
# Everything above is copy written for the inbox. This half is the other kind:
# the app already writes a notification for dozens of events, in the reader's
# language, and mailing the same event should say the same thing rather than a
# second version of it that drifts.
#
# The strings come from the app's own packs, compiled into api/notif_copy.py
# because the API image has no mobile/ directory. See
# scripts/i18n/build_notif_copy.py.

_TAG = re.compile(r"\{\{\s*(\w+)\s*\}\}")

# Params a notification carries as an API enum instead of as words, because the
# writer does not know who will read the row or in what language. The client
# localizes exactly these two; so does this, from the same packs.
ENUM_PARAMS = {"type": "REPORT_TYPES", "kind": "JOB_KINDS"}


def _fmt_tags(s: str, params: dict) -> str:
    """Interpolate the app's {{name}} placeholders.

    A separate function from _fmt rather than a conversion into it: these
    strings are shared with the client, so they must keep the client's syntax,
    and str.format would also try to read single braces that appear in ordinary
    prose.
    """
    def one(m):
        val = params.get(m.group(1))
        # None and "" count as not supplied, not as words. A row that carries
        # {"team": None} would otherwise mail "Marcus joined None." — the tag
        # is left in place instead, and notification_copy refuses the send.
        return m.group(0) if val is None or val == "" else str(val)

    return _TAG.sub(one, s or "")


def _localize_params(params: dict, lang: str) -> dict:
    from . import notif_copy

    out = dict(params or {})
    for name, table in ENUM_PARAMS.items():
        raw = out.get(name)
        if isinstance(raw, str) and raw:
            by_lang = getattr(notif_copy, table)
            words = by_lang.get(lang) or by_lang.get(DEFAULT_LANG) or {}
            # An enum the packs do not know about reads as words rather than as
            # "film_breakdown", which is what the client does with it too.
            out[name] = words.get(raw) or raw.replace("_", " ")
    return out


def notification_copy(key: str, lang: str | None,
                      params: dict | None = None) -> tuple[str, str] | None:
    """(title, body) for one in-app notification, in the reader's language.

    `key` is the row's i18n_key, with or without its "notifs." prefix. None
    when there is no copy for it at all, which is the caller's signal to send
    nothing: an email whose body is a key name is worse than no email.
    """
    from .notif_copy import NOTIF_COPY

    name = (key or "").split(".")[-1]
    by_lang = NOTIF_COPY.get(name)
    if not by_lang:
        return None
    code = (lang or DEFAULT_LANG).split("-")[0].lower()
    title, body = by_lang.get(code) or by_lang.get(DEFAULT_LANG)
    ready = _localize_params(params or {}, code)
    out = _fmt_tags(title, ready), _fmt_tags(body, ready)
    # A param the caller did not pass leaves its {{placeholder}} in the text.
    # In the app that is a cosmetic slip in a list the reader is already
    # looking at; in an inbox it is a message that reads like a broken machine
    # sent it. Nothing goes out rather than that, and the in-app notification
    # is still there to be read.
    if any(_TAG.search(part) for part in out):
        return None
    return out


def render_notification(key: str, lang: str | None, params: dict | None = None, *,
                        token: str | None = None,
                        link: str | None = None) -> tuple[str, str] | None:
    """(subject, text body) for a notification, framed like any other email."""
    pair = notification_copy(key, lang, params)
    if pair is None:
        return None
    title, body = pair
    code = (lang or DEFAULT_LANG).split("-")[0].lower()
    shell = SHELL.get(code, SHELL[DEFAULT_LANG])

    parts = [body, f"{shell['open_cta']}: {link or app_url()}", shell["signoff"]]
    if token:
        # Every one of these is an opt-out-able notification by definition:
        # account mail is not written as a notification row.
        parts.append(_fmt(shell["unsub"], {"url": unsubscribe_url(token)})
                     + "\n" + shell["unsub_note"])
    return title, "\n\n".join(parts)


def render_notification_html(key: str, lang: str | None,
                             params: dict | None = None, *,
                             token: str | None = None,
                             link: str | None = None) -> str | None:
    """The same notification, laid out. Same words, same shell as render()."""
    from .email_html import build
    from .mailer import contact_email

    pair = notification_copy(key, lang, params)
    if pair is None:
        return None
    title, body = pair
    code = (lang or DEFAULT_LANG).split("-")[0].lower()
    shell = SHELL.get(code, SHELL[DEFAULT_LANG])

    kw: dict = {
        # The title is the subject line and would be said twice if it were also
        # the greeting, so it heads the message and the body follows it.
        "heading": title,
        "body": body,
        "lang": code,
        "cta_label": shell["open_cta"],
        "cta_url": link or app_url(),
        "contact": shell.get("contact"),
        "contact_address": contact_email(),
    }
    if token:
        kw["unsub"] = shell["unsub"].replace("{url}", "").strip()
        kw["unsub_url"] = unsubscribe_url(token)
        kw["unsub_label"] = shell["unsub_link"]
    return build(**kw)


def check_notif_copy() -> list[str]:
    """Is api/notif_copy.py still what the packs say?

    Only checkable where the packs exist. The API image excludes mobile/ on
    purpose, so in production this finds nothing and says so by returning
    nothing — the check belongs to development, where the packs get edited and
    the generated file gets forgotten.
    """
    import json
    import hashlib

    from .notif_copy import SOURCE_DIGEST

    here = os.path.dirname(os.path.abspath(__file__))
    packs = os.path.join(here, "..", "mobile", "src", "i18n", "locales")
    if not os.path.isdir(packs):
        return []
    h = hashlib.sha256()
    for lang in LANGS:
        path = os.path.join(packs, f"{lang}.json")
        if not os.path.exists(path):
            return [f"locale pack missing: {lang}.json"]
        with open(path, encoding="utf-8") as f:
            pack = json.load(f)
        h.update(json.dumps(pack.get("notifs", {}), sort_keys=True,
                            ensure_ascii=False).encode())
        h.update(json.dumps(pack.get("reportTypes", {}), sort_keys=True,
                            ensure_ascii=False).encode())
        h.update(json.dumps(pack.get("jobs", {}).get("kinds", {}),
                            sort_keys=True, ensure_ascii=False).encode())
    if h.hexdigest() != SOURCE_DIGEST:
        return ["api/notif_copy.py is out of date with the locale packs. "
                "Run: python3 scripts/i18n/build_notif_copy.py"]
    return []


def render_digest(items: list[tuple[str, dict, str | None]], lang: str | None, *,
                  token: str | None = None) -> tuple[str, str] | None:
    """(subject, text) for an hour's worth of comments, as one message.

    `items` is (key, params, link) per queued notification, oldest first. Each
    becomes one line, using the same copy the single-event mail would have
    used, so a digest and a lone notification never describe the same comment
    differently.

    None when nothing in the batch has copy to render, rather than a message
    with an empty list in it.
    """
    code = (lang or DEFAULT_LANG).split("-")[0].lower()
    shell = SHELL.get(code, SHELL[DEFAULT_LANG])
    lines = []
    for key, params, _link in items:
        pair = notification_copy(key, code, params)
        if pair:
            lines.append(pair[1])
    if not lines:
        return None

    title = shell.get("digest_title", SHELL[DEFAULT_LANG]["digest_title"])
    parts = ["\n".join(f"- {line}" for line in lines)]
    # One link, to the app, rather than one per line: a text mail with six URLs
    # in it is a wall, and each of these is a thread the reader is already in.
    parts.append(f"{shell['open_cta']}: {app_url()}")
    parts.append(shell["signoff"])
    if token:
        parts.append(_fmt(shell["unsub"], {"url": unsubscribe_url(token)})
                     + "\n" + shell["unsub_note"])
    return title, "\n\n".join(parts)


def render_digest_html(items: list[tuple[str, dict, str | None]],
                       lang: str | None, *,
                       token: str | None = None) -> str | None:
    """The digest, laid out. A heading and a list, in the plain layout."""
    from .email_html import build
    from .mailer import contact_email

    code = (lang or DEFAULT_LANG).split("-")[0].lower()
    shell = SHELL.get(code, SHELL[DEFAULT_LANG])
    lines = []
    for key, params, _link in items:
        pair = notification_copy(key, code, params)
        if pair:
            lines.append(pair[1])
    if not lines:
        return None

    kw: dict = {
        "heading": shell.get("digest_title", SHELL[DEFAULT_LANG]["digest_title"]),
        # build() turns a block whose every line starts with "- " into a list.
        "body": "\n".join(f"- {line}" for line in lines),
        "lang": code,
        "cta_label": shell["open_cta"],
        "cta_url": app_url(),
        "contact": shell.get("contact"),
        "contact_address": contact_email(),
    }
    if token:
        kw["unsub"] = shell["unsub"].replace("{url}", "").strip()
        kw["unsub_url"] = unsubscribe_url(token)
        kw["unsub_label"] = shell["unsub_link"]
    return build(**kw)
