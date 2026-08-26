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
by test_emails_complete() below, which the API imports at startup.
"""
from __future__ import annotations

import os

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


def unsubscribe_url(token: str) -> str:
    """The one-click opt-out. Points at the API, which needs no session to honour it."""
    base = (os.environ.get("API_URL") or app_url()).rstrip("/")
    return f"{base}/unsubscribe?token={token}"


# The frame around every message.
#   greeting:    "Hi {name}," — omitted entirely if we have no name
#   open_cta:    label for the link into the app
#   signoff:     how the message ends
#   unsub:       the footer, with {url} for the opt-out
#   unsub_note:  reassurance that account mail is unaffected by opting out
SHELL: dict[str, dict[str, str]] = {
    "en": {
        "greeting": "Hi {name},",
        "open_cta": "Open BloomPrint",
        "signoff": "— BloomPrint",
        "unsub": "Don't want these? Turn them off: {url}",
        "unsub_note": "You'll still get messages about your own account.",
        "contact": "Questions? Email us at",
    },
    "es": {
        "greeting": "Hola {name}:",
        "open_cta": "Abrir BloomPrint",
        "signoff": "— BloomPrint",
        "unsub": "¿No quieres recibirlos? Desactívalos: {url}",
        "unsub_note": "Seguirás recibiendo mensajes sobre tu propia cuenta.",
        "contact": "¿Preguntas? Escríbenos a",
    },
    "fr": {
        "greeting": "Bonjour {name},",
        "open_cta": "Ouvrir BloomPrint",
        "signoff": "— BloomPrint",
        "unsub": "Vous ne voulez plus les recevoir ? Désactivez-les : {url}",
        "unsub_note": "Vous continuerez à recevoir les messages concernant votre compte.",
        "contact": "Des questions ? Écrivez-nous à",
    },
    "pt": {
        "greeting": "Olá {name},",
        "open_cta": "Abrir o BloomPrint",
        "signoff": "— BloomPrint",
        "unsub": "Não quer recebê-los? Desative-os: {url}",
        "unsub_note": "Continuará a receber mensagens sobre a sua própria conta.",
        "contact": "Dúvidas? Escreva para",
    },
    "it": {
        "greeting": "Ciao {name},",
        "open_cta": "Apri BloomPrint",
        "signoff": "— BloomPrint",
        "unsub": "Non vuoi riceverle? Disattivale: {url}",
        "unsub_note": "Continuerai a ricevere i messaggi relativi al tuo account.",
        "contact": "Domande? Scrivici a",
    },
    "de": {
        "greeting": "Hallo {name},",
        "open_cta": "BloomPrint öffnen",
        "signoff": "— BloomPrint",
        "unsub": "Nicht erwünscht? Hier abschalten: {url}",
        "unsub_note": "Nachrichten zu deinem eigenen Konto erhältst du weiterhin.",
        "contact": "Fragen? Schreib uns an",
    },
    "nl": {
        "greeting": "Hoi {name},",
        "open_cta": "BloomPrint openen",
        "signoff": "— BloomPrint",
        "unsub": "Liever niet? Zet ze uit: {url}",
        "unsub_note": "Berichten over je eigen account blijf je ontvangen.",
        "contact": "Vragen? Mail ons op",
    },
    "sv": {
        "greeting": "Hej {name},",
        "open_cta": "Öppna BloomPrint",
        "signoff": "— BloomPrint",
        "unsub": "Vill du inte ha dem? Stäng av dem: {url}",
        "unsub_note": "Du får fortfarande meddelanden som rör ditt eget konto.",
        "contact": "Frågor? Mejla oss på",
    },
    "pl": {
        "greeting": "Cześć {name},",
        "open_cta": "Otwórz BloomPrint",
        "signoff": "— BloomPrint",
        "unsub": "Nie chcesz ich otrzymywać? Wyłącz je: {url}",
        "unsub_note": "Wiadomości dotyczące Twojego konta będziesz otrzymywać nadal.",
        "contact": "Pytania? Napisz do nas na",
    },
    "ru": {
        "greeting": "Здравствуйте, {name}!",
        "open_cta": "Открыть BloomPrint",
        "signoff": "— BloomPrint",
        "unsub": "Не хотите их получать? Отключите: {url}",
        "unsub_note": "Сообщения о вашей учётной записи будут приходить по-прежнему.",
        "contact": "Вопросы? Напишите нам на",
    },
    "uk": {
        "greeting": "Вітаємо, {name}!",
        "open_cta": "Відкрити BloomPrint",
        "signoff": "— BloomPrint",
        "unsub": "Не хочете їх отримувати? Вимкніть: {url}",
        "unsub_note": "Повідомлення про ваш обліковий запис надходитимуть і далі.",
        "contact": "Питання? Напишіть нам на",
    },
    "sr": {
        "greeting": "Здраво {name},",
        "open_cta": "Отвори BloomPrint",
        "signoff": "— BloomPrint",
        "unsub": "Не желите ово? Искључите: {url}",
        "unsub_note": "Поруке о вашем налогу и даље ћете примати.",
        "contact": "Питања? Пишите нам на",
    },
    "hr": {
        "greeting": "Bok {name},",
        "open_cta": "Otvori BloomPrint",
        "signoff": "— BloomPrint",
        "unsub": "Ne želite ovo? Isključite: {url}",
        "unsub_note": "Poruke o vašem računu i dalje ćete primati.",
        "contact": "Pitanja? Pišite nam na",
    },
    "tr": {
        "greeting": "Merhaba {name},",
        "open_cta": "BloomPrint'i aç",
        "signoff": "— BloomPrint",
        "unsub": "Bunları istemiyor musunuz? Kapatın: {url}",
        "unsub_note": "Kendi hesabınızla ilgili mesajları almaya devam edeceksiniz.",
        "contact": "Sorunuz mu var? Bize yazın:",
    },
    "ro": {
        "greeting": "Salut {name},",
        "open_cta": "Deschide BloomPrint",
        "signoff": "— BloomPrint",
        "unsub": "Nu le vrei? Dezactivează-le: {url}",
        "unsub_note": "Vei primi în continuare mesajele despre contul tău.",
        "contact": "Întrebări? Scrie-ne la",
    },
    "el": {
        "greeting": "Γεια σου {name},",
        "open_cta": "Άνοιγμα του BloomPrint",
        "signoff": "— BloomPrint",
        "unsub": "Δεν τα θέλετε; Απενεργοποιήστε τα: {url}",
        "unsub_note": "Θα συνεχίσετε να λαμβάνετε μηνύματα για τον λογαριασμό σας.",
        "contact": "Απορίες; Γράψτε μας στο",
    },
    "lt": {
        "greeting": "Sveiki, {name},",
        "open_cta": "Atidaryti BloomPrint",
        "signoff": "— BloomPrint",
        "unsub": "Nenorite jų gauti? Išjunkite: {url}",
        "unsub_note": "Pranešimus apie savo paskyrą ir toliau gausite.",
        "contact": "Klausimai? Rašykite mums adresu",
    },
    "ar": {
        "greeting": "مرحبًا {name}،",
        "open_cta": "فتح BloomPrint",
        "signoff": "— BloomPrint",
        "unsub": "لا تريد هذه الرسائل؟ أوقفها: {url}",
        "unsub_note": "ستستمر في تلقّي الرسائل المتعلقة بحسابك.",
        "contact": "أسئلة؟ راسلنا على",
    },
    "he": {
        "greeting": "שלום {name},",
        "open_cta": "פתיחת BloomPrint",
        "signoff": "— BloomPrint",
        "unsub": "לא מעוניין בהודעות האלה? אפשר לכבות: {url}",
        "unsub_note": "הודעות שנוגעות לחשבון שלך ימשיכו להישלח.",
        "contact": "שאלות? כתבו לנו אל",
    },
    "hi": {
        "greeting": "नमस्ते {name},",
        "open_cta": "BloomPrint खोलें",
        "signoff": "— BloomPrint",
        "unsub": "ये नहीं चाहिए? इन्हें बंद करें: {url}",
        "unsub_note": "आपके अपने खाते से जुड़े संदेश आपको मिलते रहेंगे।",
        "contact": "सवाल? हमें यहाँ लिखें",
    },
    "ka": {
        "greeting": "გამარჯობა, {name},",
        "open_cta": "BloomPrint-ის გახსნა",
        "signoff": "— BloomPrint",
        "unsub": "აღარ გსურთ მათი მიღება? გამორთეთ: {url}",
        "unsub_note": "თქვენს ანგარიშთან დაკავშირებულ შეტყობინებებს კვლავ მიიღებთ.",
        "contact": "შეკითხვები? მოგვწერეთ",
    },
    "ja": {
        "greeting": "{name} さん",
        "open_cta": "BloomPrint を開く",
        "signoff": "— BloomPrint",
        "unsub": "不要な場合はこちらから停止できます: {url}",
        "unsub_note": "アカウントに関するお知らせは引き続きお送りします。",
        "contact": "ご質問は",
    },
    "ko": {
        "greeting": "{name}님, 안녕하세요.",
        "open_cta": "BloomPrint 열기",
        "signoff": "— BloomPrint",
        "unsub": "받고 싶지 않으신가요? 여기에서 끄세요: {url}",
        "unsub_note": "계정 관련 안내는 계속 발송됩니다.",
        "contact": "문의는",
    },
    "zh": {
        "greeting": "{name} 你好，",
        "open_cta": "打开 BloomPrint",
        "signoff": "— BloomPrint",
        "unsub": "不想收到这些邮件？可在此关闭：{url}",
        "unsub_note": "与你账号相关的邮件仍会照常发送。",
        "contact": "有问题？请发邮件至",
    },
    "tl": {
        "greeting": "Kumusta {name},",
        "open_cta": "Buksan ang BloomPrint",
        "signoff": "— BloomPrint",
        "unsub": "Ayaw mo ng mga ito? I-off sila: {url}",
        "unsub_note": "Patuloy mo pa ring matatanggap ang mga mensahe tungkol sa sarili mong account.",
        "contact": "May tanong? Mag-email sa",
    },
}

# Which events exist, and whether opting out silences them.
#
# Account mail is transactional: someone asked for it by signing up or by
# changing their address, and suppressing it would leave them unable to use
# what they asked for. Activity mail is about other people's actions, and that
# is what the opt-out is for.
ACCOUNT_EVENTS = {"signup_coach", "signup_player", "email_changed"}


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
    parts.append(_fmt(line, params))
    parts.append(f"{shell['open_cta']}: {link or app_url()}")
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
