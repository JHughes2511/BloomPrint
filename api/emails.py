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


def decide_urls(token: str) -> tuple[str, str]:
    """(approve, decline) for one decision link.

    Points at the API rather than the app: whoever follows it is not signed in,
    and the page that asks them to confirm is served by the server that can
    check the token. Following either URL decides nothing on its own; see
    api/decisions.py for why.
    """
    base = (os.environ.get("API_URL") or app_url()).rstrip("/")
    return (f"{base}/decide?token={token}&choice=approve",
            f"{base}/decide?token={token}&choice=reject")


def undo_deletion_url(token: str) -> str:
    """The link that calls off a deletion. Served by the API, not the app: the
    account is closed, so there is no session to open the app with."""
    base = (os.environ.get("API_URL") or app_url()).rstrip("/")
    return f"{base}/undo-deletion?token={token}"


def unsubscribe_url(token: str) -> str:
    """The one-click opt-out. Points at the API, which needs no session to honour it."""
    base = (os.environ.get("API_URL") or app_url()).rstrip("/")
    return f"{base}/unsubscribe?token={token}"


# The frame around every message.
#   greeting:    "Hi {name}," — omitted entirely if we have no name
#   open_cta:    label for the link into the app
#   reset_cta:   label for that link when it is a password-reset link, because
#                a button that says "Open BloomPrint" hides what it does
#   undo_cta:    label for the link that calls off a deletion. Says what it
#                does rather than "Open BloomPrint", which on that message
#                would be the one button nobody dares press.
#   claim_cta:   the one button on a "this team has no owner" message. A single
#                action, not an approve-or-decline, so it says what it does.
#   claim_taken: what the page says when somebody got there first. Names them,
#                because "already answered" leaves you wondering who has it.
#   digest_title: subject and heading of the hourly digest. No count in
#                it on purpose: "3 new comments" needs plural rules that differ
#                across these twenty-five languages, and the list is right there
#                underneath anyway
#   decide_*:    the approve-or-decline page reached from an email button. See
#                api/decisions.py; the page is served by the API, not the app,
#                because whoever follows the link is not signed in.
#   signoff:     how the message ends
#   unsub:       the footer, with {url} for the opt-out
#   unsub_note:  reassurance that account mail is unaffected by opting out
#   unsub_done_*: the page the opt-out link lands on. A link that answers in a
#                language the reader does not have is a page that looks like it
#                failed, and this one is reached FROM a message we already sent
#                them in their own.
SHELL: dict[str, dict[str, str]] = {
    "en": {
        "greeting": "Hi {name},",
        "open_cta": "Open BloomPrint",
        "reset_cta": "Choose a new password",
        "undo_cta": "Keep my account",
        "claim_cta": "Claim this team",
        "claim_taken": "{name} has already claimed {team}.",
        "digest_title": "New comments and messages",
        "decide_approve": "Approve",
        "decide_reject": "Decline",
        "decide_ask": "Confirm your answer",
        "decide_approved": "Approved.",
        "decide_rejected": "Declined.",
        "decide_gone": "This has already been answered.",
        "decide_expired": "This link has expired. Open BloomPrint to answer it.",
        "decide_failed": "Something went wrong. Open BloomPrint to answer it.",
        "signoff": "BloomPrint",
        "unsub": "Don't want these? Turn them off: {url}",
        "unsub_note": "You'll still get messages about your own account.",
        "contact": "Questions? Email us at",
        "account_ready": "Your account is ready.",
        "unsub_link": "unsubscribe",
        "unsub_done_title": "Unsubscribed",
        "unsub_done_body": "You won't get email about other people's activity any more. Messages about your own account will still be sent.",
    },
    "es": {
        "greeting": "Hola {name}:",
        "open_cta": "Abrir BloomPrint",
        "reset_cta": "Elegir una contraseña nueva",
        "undo_cta": "Conservar mi cuenta",
        "claim_cta": "Quedarme con este equipo",
        "claim_taken": "{name} ya se ha quedado con {team}.",
        "digest_title": "Nuevos comentarios y mensajes",
        "decide_approve": "Aprobar",
        "decide_reject": "Rechazar",
        "decide_ask": "Confirma tu respuesta",
        "decide_approved": "Aprobado.",
        "decide_rejected": "Rechazado.",
        "decide_gone": "Esto ya se ha respondido.",
        "decide_expired": "Este enlace ha caducado. Abre BloomPrint para responder.",
        "decide_failed": "Algo ha fallado. Abre BloomPrint para responder.",
        "signoff": "BloomPrint",
        "unsub": "¿No quieres recibirlos? Desactívalos: {url}",
        "unsub_note": "Seguirás recibiendo mensajes sobre tu propia cuenta.",
        "contact": "¿Preguntas? Escríbenos a",
        "account_ready": "Tu cuenta está lista.",
        "unsub_link": "darse de baja",
        "unsub_done_title": "Baja confirmada",
        "unsub_done_body": "Ya no recibirás correos sobre la actividad de otras personas. Los mensajes sobre tu propia cuenta se seguirán enviando.",
    },
    "fr": {
        "greeting": "Bonjour {name},",
        "open_cta": "Ouvrir BloomPrint",
        "reset_cta": "Choisir un nouveau mot de passe",
        "undo_cta": "Conserver mon compte",
        "claim_cta": "Reprendre cette équipe",
        "claim_taken": "{name} a déjà repris {team}.",
        "digest_title": "Nouveaux commentaires et messages",
        "decide_approve": "Approuver",
        "decide_reject": "Refuser",
        "decide_ask": "Confirmez votre réponse",
        "decide_approved": "Approuvé.",
        "decide_rejected": "Refusé.",
        "decide_gone": "Cela a déjà été traité.",
        "decide_expired": "Ce lien a expiré. Ouvrez BloomPrint pour répondre.",
        "decide_failed": "Une erreur est survenue. Ouvrez BloomPrint pour répondre.",
        "signoff": "BloomPrint",
        "unsub": "Vous ne voulez plus les recevoir ? Désactivez-les : {url}",
        "unsub_note": "Vous continuerez à recevoir les messages concernant votre compte.",
        "contact": "Des questions ? Écrivez-nous à",
        "account_ready": "Votre compte est prêt.",
        "unsub_link": "se désabonner",
        "unsub_done_title": "Désabonné",
        "unsub_done_body": "Vous ne recevrez plus d'e-mails sur l'activité des autres. Les messages concernant votre compte continueront d'arriver.",
    },
    "pt": {
        "greeting": "Olá {name},",
        "open_cta": "Abrir o BloomPrint",
        "reset_cta": "Escolher uma nova palavra-passe",
        "undo_cta": "Manter a minha conta",
        "claim_cta": "Assumir esta equipa",
        "claim_taken": "{name} já assumiu {team}.",
        "digest_title": "Novos comentários e mensagens",
        "decide_approve": "Aprovar",
        "decide_reject": "Recusar",
        "decide_ask": "Confirme a sua resposta",
        "decide_approved": "Aprovado.",
        "decide_rejected": "Recusado.",
        "decide_gone": "Isto já foi respondido.",
        "decide_expired": "Esta ligação expirou. Abra o BloomPrint para responder.",
        "decide_failed": "Algo correu mal. Abra o BloomPrint para responder.",
        "signoff": "BloomPrint",
        "unsub": "Não quer recebê-los? Desative-os: {url}",
        "unsub_note": "Continuará a receber mensagens sobre a sua própria conta.",
        "contact": "Dúvidas? Escreva para",
        "account_ready": "A sua conta está pronta.",
        "unsub_link": "cancelar subscrição",
        "unsub_done_title": "Subscrição cancelada",
        "unsub_done_body": "Deixará de receber emails sobre a atividade de outras pessoas. As mensagens sobre a sua própria conta continuarão a ser enviadas.",
    },
    "it": {
        "greeting": "Ciao {name},",
        "open_cta": "Apri BloomPrint",
        "reset_cta": "Scegli una nuova password",
        "undo_cta": "Mantieni il mio account",
        "claim_cta": "Prendi questa squadra",
        "claim_taken": "{name} ha già preso {team}.",
        "digest_title": "Nuovi commenti e messaggi",
        "decide_approve": "Approva",
        "decide_reject": "Rifiuta",
        "decide_ask": "Conferma la tua risposta",
        "decide_approved": "Approvato.",
        "decide_rejected": "Rifiutato.",
        "decide_gone": "È già stato deciso.",
        "decide_expired": "Questo link è scaduto. Apri BloomPrint per rispondere.",
        "decide_failed": "Qualcosa è andato storto. Apri BloomPrint per rispondere.",
        "signoff": "BloomPrint",
        "unsub": "Non vuoi riceverle? Disattivale: {url}",
        "unsub_note": "Continuerai a ricevere i messaggi relativi al tuo account.",
        "contact": "Domande? Scrivici a",
        "account_ready": "Il tuo account è pronto.",
        "unsub_link": "annulla iscrizione",
        "unsub_done_title": "Disiscritto",
        "unsub_done_body": "Non riceverai più email sull'attività degli altri. I messaggi sul tuo account continueranno ad arrivare.",
    },
    "de": {
        "greeting": "Hallo {name},",
        "open_cta": "BloomPrint öffnen",
        "reset_cta": "Neues Passwort wählen",
        "undo_cta": "Konto behalten",
        "claim_cta": "Team übernehmen",
        "claim_taken": "{name} hat {team} bereits übernommen.",
        "digest_title": "Neue Kommentare und Nachrichten",
        "decide_approve": "Genehmigen",
        "decide_reject": "Ablehnen",
        "decide_ask": "Bestätige deine Antwort",
        "decide_approved": "Genehmigt.",
        "decide_rejected": "Abgelehnt.",
        "decide_gone": "Das wurde bereits beantwortet.",
        "decide_expired": "Dieser Link ist abgelaufen. Öffne BloomPrint, um zu antworten.",
        "decide_failed": "Etwas ist schiefgelaufen. Öffne BloomPrint, um zu antworten.",
        "signoff": "BloomPrint",
        "unsub": "Nicht erwünscht? Hier abschalten: {url}",
        "unsub_note": "Nachrichten zu deinem eigenen Konto erhältst du weiterhin.",
        "contact": "Fragen? Schreib uns an",
        "account_ready": "Dein Konto ist bereit.",
        "unsub_link": "abbestellen",
        "unsub_done_title": "Abgemeldet",
        "unsub_done_body": "Du bekommst keine E-Mails mehr über die Aktivität anderer. Nachrichten zu deinem eigenen Konto werden weiter gesendet.",
    },
    "nl": {
        "greeting": "Hoi {name},",
        "open_cta": "BloomPrint openen",
        "reset_cta": "Nieuw wachtwoord kiezen",
        "undo_cta": "Mijn account behouden",
        "claim_cta": "Dit team overnemen",
        "claim_taken": "{name} heeft {team} al overgenomen.",
        "digest_title": "Nieuwe reacties en berichten",
        "decide_approve": "Goedkeuren",
        "decide_reject": "Afwijzen",
        "decide_ask": "Bevestig je antwoord",
        "decide_approved": "Goedgekeurd.",
        "decide_rejected": "Afgewezen.",
        "decide_gone": "Dit is al beantwoord.",
        "decide_expired": "Deze link is verlopen. Open BloomPrint om te antwoorden.",
        "decide_failed": "Er ging iets mis. Open BloomPrint om te antwoorden.",
        "signoff": "BloomPrint",
        "unsub": "Liever niet? Zet ze uit: {url}",
        "unsub_note": "Berichten over je eigen account blijf je ontvangen.",
        "contact": "Vragen? Mail ons op",
        "account_ready": "Je account is klaar.",
        "unsub_link": "afmelden",
        "unsub_done_title": "Afgemeld",
        "unsub_done_body": "Je krijgt geen e-mails meer over de activiteit van anderen. Berichten over je eigen account blijven komen.",
    },
    "sv": {
        "greeting": "Hej {name},",
        "open_cta": "Öppna BloomPrint",
        "reset_cta": "Välj ett nytt lösenord",
        "undo_cta": "Behåll mitt konto",
        "claim_cta": "Ta över laget",
        "claim_taken": "{name} har redan tagit över {team}.",
        "digest_title": "Nya kommentarer och meddelanden",
        "decide_approve": "Godkänn",
        "decide_reject": "Avböj",
        "decide_ask": "Bekräfta ditt svar",
        "decide_approved": "Godkänt.",
        "decide_rejected": "Avböjt.",
        "decide_gone": "Det här är redan besvarat.",
        "decide_expired": "Länken har gått ut. Öppna BloomPrint för att svara.",
        "decide_failed": "Något gick fel. Öppna BloomPrint för att svara.",
        "signoff": "BloomPrint",
        "unsub": "Vill du inte ha dem? Stäng av dem: {url}",
        "unsub_note": "Du får fortfarande meddelanden som rör ditt eget konto.",
        "contact": "Frågor? Mejla oss på",
        "account_ready": "Ditt konto är klart.",
        "unsub_link": "avsluta prenumeration",
        "unsub_done_title": "Avregistrerad",
        "unsub_done_body": "Du får inte längre e-post om andras aktivitet. Meddelanden om ditt eget konto skickas fortfarande.",
    },
    "pl": {
        "greeting": "Cześć {name},",
        "open_cta": "Otwórz BloomPrint",
        "reset_cta": "Ustaw nowe hasło",
        "undo_cta": "Zachowaj moje konto",
        "claim_cta": "Przejmij zespół",
        "claim_taken": "{name} już przejął {team}.",
        "digest_title": "Nowe komentarze i wiadomości",
        "decide_approve": "Zatwierdź",
        "decide_reject": "Odrzuć",
        "decide_ask": "Potwierdź swoją odpowiedź",
        "decide_approved": "Zatwierdzono.",
        "decide_rejected": "Odrzucono.",
        "decide_gone": "To już zostało rozstrzygnięte.",
        "decide_expired": "Ten link wygasł. Otwórz BloomPrint, aby odpowiedzieć.",
        "decide_failed": "Coś poszło nie tak. Otwórz BloomPrint, aby odpowiedzieć.",
        "signoff": "BloomPrint",
        "unsub": "Nie chcesz ich otrzymywać? Wyłącz je: {url}",
        "unsub_note": "Wiadomości dotyczące Twojego konta będziesz otrzymywać nadal.",
        "contact": "Pytania? Napisz do nas na",
        "account_ready": "Twoje konto jest gotowe.",
        "unsub_link": "zrezygnuj",
        "unsub_done_title": "Zrezygnowano",
        "unsub_done_body": "Nie będziesz już dostawać e-maili o aktywności innych osób. Wiadomości o Twoim koncie nadal będą wysyłane.",
    },
    "ru": {
        "greeting": "Здравствуйте, {name}!",
        "open_cta": "Открыть BloomPrint",
        "reset_cta": "Задать новый пароль",
        "undo_cta": "Оставить аккаунт",
        "claim_cta": "Взять команду себе",
        "claim_taken": "{name} уже взял команду {team}.",
        "digest_title": "Новые комментарии и сообщения",
        "decide_approve": "Одобрить",
        "decide_reject": "Отклонить",
        "decide_ask": "Подтвердите свой ответ",
        "decide_approved": "Одобрено.",
        "decide_rejected": "Отклонено.",
        "decide_gone": "На это уже ответили.",
        "decide_expired": "Срок действия ссылки истёк. Откройте BloomPrint, чтобы ответить.",
        "decide_failed": "Что-то пошло не так. Откройте BloomPrint, чтобы ответить.",
        "signoff": "BloomPrint",
        "unsub": "Не хотите их получать? Отключите: {url}",
        "unsub_note": "Сообщения о вашей учётной записи будут приходить по-прежнему.",
        "contact": "Вопросы? Напишите нам на",
        "account_ready": "Ваш аккаунт готов.",
        "unsub_link": "отписаться",
        "unsub_done_title": "Вы отписаны",
        "unsub_done_body": "Вы больше не будете получать письма об активности других. Сообщения о вашей учётной записи будут приходить по-прежнему.",
    },
    "uk": {
        "greeting": "Вітаємо, {name}!",
        "open_cta": "Відкрити BloomPrint",
        "reset_cta": "Задати новий пароль",
        "undo_cta": "Залишити обліковий запис",
        "claim_cta": "Взяти команду собі",
        "claim_taken": "{name} уже взяв команду {team}.",
        "digest_title": "Нові коментарі та повідомлення",
        "decide_approve": "Схвалити",
        "decide_reject": "Відхилити",
        "decide_ask": "Підтвердьте свою відповідь",
        "decide_approved": "Схвалено.",
        "decide_rejected": "Відхилено.",
        "decide_gone": "На це вже відповіли.",
        "decide_expired": "Термін дії посилання минув. Відкрийте BloomPrint, щоб відповісти.",
        "decide_failed": "Щось пішло не так. Відкрийте BloomPrint, щоб відповісти.",
        "signoff": "BloomPrint",
        "unsub": "Не хочете їх отримувати? Вимкніть: {url}",
        "unsub_note": "Повідомлення про ваш обліковий запис надходитимуть і далі.",
        "contact": "Питання? Напишіть нам на",
        "account_ready": "Ваш обліковий запис готовий.",
        "unsub_link": "відписатися",
        "unsub_done_title": "Ви відписані",
        "unsub_done_body": "Ви більше не отримуватимете листи про активність інших. Повідомлення про ваш обліковий запис надходитимуть і далі.",
    },
    "sr": {
        "greeting": "Здраво {name},",
        "open_cta": "Отвори BloomPrint",
        "reset_cta": "Изаберите нову лозинку",
        "undo_cta": "Задржи мој налог",
        "claim_cta": "Преузми овај тим",
        "claim_taken": "{name} је већ преузео {team}.",
        "digest_title": "Нови коментари и поруке",
        "decide_approve": "Одобри",
        "decide_reject": "Одбиј",
        "decide_ask": "Потврдите свој одговор",
        "decide_approved": "Одобрено.",
        "decide_rejected": "Одбијено.",
        "decide_gone": "На ово је већ одговорено.",
        "decide_expired": "Ова веза је истекла. Отворите BloomPrint да одговорите.",
        "decide_failed": "Нешто није у реду. Отворите BloomPrint да одговорите.",
        "signoff": "BloomPrint",
        "unsub": "Не желите ово? Искључите: {url}",
        "unsub_note": "Поруке о вашем налогу и даље ћете примати.",
        "contact": "Питања? Пишите нам на",
        "account_ready": "Ваш налог је спреман.",
        "unsub_link": "одјави се",
        "unsub_done_title": "Одјављени сте",
        "unsub_done_body": "Више нећете добијати имејлове о активности других. Поруке о вашем налогу и даље ће се слати.",
    },
    "hr": {
        "greeting": "Bok {name},",
        "open_cta": "Otvori BloomPrint",
        "reset_cta": "Odaberite novu lozinku",
        "undo_cta": "Zadrži moj račun",
        "claim_cta": "Preuzmi ovu momčad",
        "claim_taken": "{name} je već preuzeo {team}.",
        "digest_title": "Novi komentari i poruke",
        "decide_approve": "Odobri",
        "decide_reject": "Odbij",
        "decide_ask": "Potvrdite svoj odgovor",
        "decide_approved": "Odobreno.",
        "decide_rejected": "Odbijeno.",
        "decide_gone": "Na ovo je već odgovoreno.",
        "decide_expired": "Ova poveznica je istekla. Otvorite BloomPrint za odgovor.",
        "decide_failed": "Nešto je pošlo po zlu. Otvorite BloomPrint za odgovor.",
        "signoff": "BloomPrint",
        "unsub": "Ne želite ovo? Isključite: {url}",
        "unsub_note": "Poruke o vašem računu i dalje ćete primati.",
        "contact": "Pitanja? Pišite nam na",
        "account_ready": "Vaš račun je spreman.",
        "unsub_link": "odjavi se",
        "unsub_done_title": "Odjavljeni ste",
        "unsub_done_body": "Više nećete dobivati e-poštu o aktivnosti drugih. Poruke o vašem računu i dalje će se slati.",
    },
    "tr": {
        "greeting": "Merhaba {name},",
        "open_cta": "BloomPrint'i aç",
        "reset_cta": "Yeni şifre belirle",
        "undo_cta": "Hesabımı koru",
        "claim_cta": "Bu takımı devral",
        "claim_taken": "{name}, {team} takımını çoktan devraldı.",
        "digest_title": "Yeni yorumlar ve mesajlar",
        "decide_approve": "Onayla",
        "decide_reject": "Reddet",
        "decide_ask": "Yanıtınızı onaylayın",
        "decide_approved": "Onaylandı.",
        "decide_rejected": "Reddedildi.",
        "decide_gone": "Bu zaten yanıtlandı.",
        "decide_expired": "Bu bağlantının süresi doldu. Yanıtlamak için BloomPrint'i açın.",
        "decide_failed": "Bir şeyler ters gitti. Yanıtlamak için BloomPrint'i açın.",
        "signoff": "BloomPrint",
        "unsub": "Bunları istemiyor musunuz? Kapatın: {url}",
        "unsub_note": "Kendi hesabınızla ilgili mesajları almaya devam edeceksiniz.",
        "contact": "Sorunuz mu var? Bize yazın:",
        "account_ready": "Hesabınız hazır.",
        "unsub_link": "aboneliği bırak",
        "unsub_done_title": "Abonelikten çıkıldı",
        "unsub_done_body": "Artık başkalarının etkinliğiyle ilgili e-posta almayacaksınız. Kendi hesabınızla ilgili mesajlar gönderilmeye devam eder.",
    },
    "ro": {
        "greeting": "Salut {name},",
        "open_cta": "Deschide BloomPrint",
        "reset_cta": "Alege o parolă nouă",
        "undo_cta": "Păstrează contul",
        "claim_cta": "Preia această echipă",
        "claim_taken": "{name} a preluat deja {team}.",
        "digest_title": "Comentarii și mesaje noi",
        "decide_approve": "Aprobă",
        "decide_reject": "Respinge",
        "decide_ask": "Confirmă răspunsul",
        "decide_approved": "Aprobat.",
        "decide_rejected": "Respins.",
        "decide_gone": "S-a răspuns deja la aceasta.",
        "decide_expired": "Acest link a expirat. Deschide BloomPrint pentru a răspunde.",
        "decide_failed": "Ceva nu a mers bine. Deschide BloomPrint pentru a răspunde.",
        "signoff": "BloomPrint",
        "unsub": "Nu le vrei? Dezactivează-le: {url}",
        "unsub_note": "Vei primi în continuare mesajele despre contul tău.",
        "contact": "Întrebări? Scrie-ne la",
        "account_ready": "Contul tău este gata.",
        "unsub_link": "dezabonare",
        "unsub_done_title": "Dezabonat",
        "unsub_done_body": "Nu vei mai primi e-mailuri despre activitatea altora. Mesajele despre contul tău vor fi trimise în continuare.",
    },
    "el": {
        "greeting": "Γεια σου {name},",
        "open_cta": "Άνοιγμα του BloomPrint",
        "reset_cta": "Επιλογή νέου κωδικού",
        "undo_cta": "Διατήρηση του λογαριασμού μου",
        "claim_cta": "Ανάληψη της ομάδας",
        "claim_taken": "Ο/Η {name} έχει ήδη αναλάβει την {team}.",
        "digest_title": "Νέα σχόλια και μηνύματα",
        "decide_approve": "Έγκριση",
        "decide_reject": "Απόρριψη",
        "decide_ask": "Επιβεβαίωσε την απάντησή σου",
        "decide_approved": "Εγκρίθηκε.",
        "decide_rejected": "Απορρίφθηκε.",
        "decide_gone": "Έχει ήδη απαντηθεί.",
        "decide_expired": "Ο σύνδεσμος έληξε. Άνοιξε το BloomPrint για να απαντήσεις.",
        "decide_failed": "Κάτι πήγε στραβά. Άνοιξε το BloomPrint για να απαντήσεις.",
        "signoff": "BloomPrint",
        "unsub": "Δεν τα θέλετε; Απενεργοποιήστε τα: {url}",
        "unsub_note": "Θα συνεχίσετε να λαμβάνετε μηνύματα για τον λογαριασμό σας.",
        "contact": "Απορίες; Γράψτε μας στο",
        "account_ready": "Ο λογαριασμός σας είναι έτοιμος.",
        "unsub_link": "κατάργηση εγγραφής",
        "unsub_done_title": "Διαγραφή ολοκληρώθηκε",
        "unsub_done_body": "Δεν θα λαμβάνετε πλέον email για τη δραστηριότητα άλλων. Τα μηνύματα για τον δικό σας λογαριασμό θα συνεχίσουν να στέλνονται.",
    },
    "lt": {
        "greeting": "Sveiki, {name},",
        "open_cta": "Atidaryti BloomPrint",
        "reset_cta": "Nustatyti naują slaptažodį",
        "undo_cta": "Palikti mano paskyrą",
        "claim_cta": "Perimti šią komandą",
        "claim_taken": "{name} jau perėmė {team}.",
        "digest_title": "Nauji komentarai ir žinutės",
        "decide_approve": "Patvirtinti",
        "decide_reject": "Atmesti",
        "decide_ask": "Patvirtinkite savo atsakymą",
        "decide_approved": "Patvirtinta.",
        "decide_rejected": "Atmesta.",
        "decide_gone": "Į tai jau atsakyta.",
        "decide_expired": "Šios nuorodos galiojimas baigėsi. Atidarykite BloomPrint, kad atsakytumėte.",
        "decide_failed": "Kažkas nepavyko. Atidarykite BloomPrint, kad atsakytumėte.",
        "signoff": "BloomPrint",
        "unsub": "Nenorite jų gauti? Išjunkite: {url}",
        "unsub_note": "Pranešimus apie savo paskyrą ir toliau gausite.",
        "contact": "Klausimai? Rašykite mums adresu",
        "account_ready": "Jūsų paskyra paruošta.",
        "unsub_link": "atsisakyti",
        "unsub_done_title": "Atsisakyta prenumeratos",
        "unsub_done_body": "Nebegausite el. laiškų apie kitų veiklą. Žinutės apie jūsų paskyrą ir toliau bus siunčiamos.",
    },
    "ar": {
        "greeting": "مرحبًا {name}،",
        "open_cta": "فتح BloomPrint",
        "reset_cta": "اختيار كلمة مرور جديدة",
        "undo_cta": "الاحتفاظ بحسابي",
        "claim_cta": "تولّي هذا الفريق",
        "claim_taken": "تولّى {name} فريق {team} بالفعل.",
        "digest_title": "تعليقات ورسائل جديدة",
        "decide_approve": "موافقة",
        "decide_reject": "رفض",
        "decide_ask": "أكّد إجابتك",
        "decide_approved": "تمت الموافقة.",
        "decide_rejected": "تم الرفض.",
        "decide_gone": "تمت الإجابة على هذا بالفعل.",
        "decide_expired": "انتهت صلاحية هذا الرابط. افتح BloomPrint للرد.",
        "decide_failed": "حدث خطأ ما. افتح BloomPrint للرد.",
        "signoff": "BloomPrint",
        "unsub": "لا تريد هذه الرسائل؟ أوقفها: {url}",
        "unsub_note": "ستستمر في تلقّي الرسائل المتعلقة بحسابك.",
        "contact": "أسئلة؟ راسلنا على",
        "account_ready": "حسابك جاهز.",
        "unsub_link": "إلغاء الاشتراك",
        "unsub_done_title": "تم إلغاء الاشتراك",
        "unsub_done_body": "لن تصلك بعد الآن رسائل عن نشاط الآخرين. أما الرسائل الخاصة بحسابك فستستمر.",
    },
    "he": {
        "greeting": "שלום {name},",
        "open_cta": "פתיחת BloomPrint",
        "reset_cta": "בחירת סיסמה חדשה",
        "undo_cta": "להשאיר את החשבון שלי",
        "claim_cta": "לקחת את הקבוצה",
        "claim_taken": "{name} כבר לקח את {team}.",
        "digest_title": "תגובות והודעות חדשות",
        "decide_approve": "אישור",
        "decide_reject": "דחייה",
        "decide_ask": "אשר את תשובתך",
        "decide_approved": "אושר.",
        "decide_rejected": "נדחה.",
        "decide_gone": "כבר ניתנה תשובה על כך.",
        "decide_expired": "תוקף הקישור פג. פתח את BloomPrint כדי להשיב.",
        "decide_failed": "משהו השתבש. פתח את BloomPrint כדי להשיב.",
        "signoff": "BloomPrint",
        "unsub": "לא מעוניין בהודעות האלה? אפשר לכבות: {url}",
        "unsub_note": "הודעות שנוגעות לחשבון שלך ימשיכו להישלח.",
        "contact": "שאלות? כתבו לנו אל",
        "account_ready": "החשבון שלך מוכן.",
        "unsub_link": "ביטול הרשמה",
        "unsub_done_title": "ההרשמה בוטלה",
        "unsub_done_body": "לא תקבלו יותר מיילים על פעילות של אחרים. הודעות על החשבון שלכם ימשיכו להישלח.",
    },
    "hi": {
        "greeting": "नमस्ते {name},",
        "open_cta": "BloomPrint खोलें",
        "reset_cta": "नया पासवर्ड चुनें",
        "undo_cta": "मेरा खाता रखें",
        "claim_cta": "यह टीम लें",
        "claim_taken": "{name} पहले ही {team} ले चुके हैं।",
        "digest_title": "नई टिप्पणियाँ और संदेश",
        "decide_approve": "स्वीकार करें",
        "decide_reject": "अस्वीकार करें",
        "decide_ask": "अपना उत्तर पुष्ट करें",
        "decide_approved": "स्वीकृत।",
        "decide_rejected": "अस्वीकृत।",
        "decide_gone": "इसका उत्तर पहले ही दिया जा चुका है।",
        "decide_expired": "यह लिंक समाप्त हो गया है। उत्तर देने के लिए BloomPrint खोलें।",
        "decide_failed": "कुछ गड़बड़ हो गई। उत्तर देने के लिए BloomPrint खोलें।",
        "signoff": "BloomPrint",
        "unsub": "ये नहीं चाहिए? इन्हें बंद करें: {url}",
        "unsub_note": "आपके अपने खाते से जुड़े संदेश आपको मिलते रहेंगे।",
        "contact": "सवाल? हमें यहाँ लिखें",
        "account_ready": "आपका खाता तैयार है।",
        "unsub_link": "सदस्यता समाप्त करें",
        "unsub_done_title": "सदस्यता समाप्त",
        "unsub_done_body": "अब आपको दूसरों की गतिविधि के ईमेल नहीं मिलेंगे। आपके अपने खाते से जुड़े संदेश आते रहेंगे।",
    },
    "ka": {
        "greeting": "გამარჯობა, {name},",
        "open_cta": "BloomPrint-ის გახსნა",
        "reset_cta": "ახალი პაროლის არჩევა",
        "undo_cta": "ჩემი ანგარიშის შენარჩუნება",
        "claim_cta": "ამ გუნდის აღება",
        "claim_taken": "{name}-მა უკვე აიღო {team}.",
        "digest_title": "ახალი კომენტარები და შეტყობინებები",
        "decide_approve": "დამტკიცება",
        "decide_reject": "უარყოფა",
        "decide_ask": "დაადასტურეთ თქვენი პასუხი",
        "decide_approved": "დამტკიცდა.",
        "decide_rejected": "უარყოფილია.",
        "decide_gone": "ამაზე უკვე გაცემულია პასუხი.",
        "decide_expired": "ბმულს ვადა გაუვიდა. გახსენით BloomPrint პასუხისთვის.",
        "decide_failed": "რაღაც ვერ გამოვიდა. გახსენით BloomPrint პასუხისთვის.",
        "signoff": "BloomPrint",
        "unsub": "აღარ გსურთ მათი მიღება? გამორთეთ: {url}",
        "unsub_note": "თქვენს ანგარიშთან დაკავშირებულ შეტყობინებებს კვლავ მიიღებთ.",
        "contact": "შეკითხვები? მოგვწერეთ",
        "account_ready": "თქვენი ანგარიში მზადაა.",
        "unsub_link": "გამოწერის გაუქმება",
        "unsub_done_title": "გამოწერა გაუქმებულია",
        "unsub_done_body": "აღარ მიიღებთ წერილებს სხვების აქტივობის შესახებ. თქვენს ანგარიშთან დაკავშირებული შეტყობინებები კვლავ გამოგეგზავნებათ.",
    },
    "ja": {
        "greeting": "{name} さん",
        "open_cta": "BloomPrint を開く",
        "reset_cta": "新しいパスワードを設定",
        "undo_cta": "アカウントを残す",
        "claim_cta": "このチームを引き継ぐ",
        "claim_taken": "{name} がすでに {team} を引き継ぎました。",
        "digest_title": "新しいコメントとメッセージ",
        "decide_approve": "承認する",
        "decide_reject": "却下する",
        "decide_ask": "回答を確認してください",
        "decide_approved": "承認しました。",
        "decide_rejected": "却下しました。",
        "decide_gone": "これはすでに回答済みです。",
        "decide_expired": "このリンクは期限切れです。BloomPrint を開いて回答してください。",
        "decide_failed": "うまくいきませんでした。BloomPrint を開いて回答してください。",
        "signoff": "BloomPrint",
        "unsub": "不要な場合はこちらから停止できます: {url}",
        "unsub_note": "アカウントに関するお知らせは引き続きお送りします。",
        "contact": "ご質問は",
        "account_ready": "アカウントの準備ができました。",
        "unsub_link": "配信停止",
        "unsub_done_title": "配信を停止しました",
        "unsub_done_body": "他の人の活動に関するメールは届かなくなります。ご自身のアカウントに関するお知らせは引き続き送信されます。",
    },
    "ko": {
        "greeting": "{name}님, 안녕하세요.",
        "open_cta": "BloomPrint 열기",
        "reset_cta": "새 비밀번호 설정",
        "undo_cta": "계정 유지하기",
        "claim_cta": "이 팀 맡기",
        "claim_taken": "{name} 님이 이미 {team}을 맡았습니다.",
        "digest_title": "새 댓글과 메시지",
        "decide_approve": "승인",
        "decide_reject": "거절",
        "decide_ask": "답변을 확인하세요",
        "decide_approved": "승인했습니다.",
        "decide_rejected": "거절했습니다.",
        "decide_gone": "이미 처리된 요청입니다.",
        "decide_expired": "링크가 만료되었습니다. BloomPrint에서 답변해 주세요.",
        "decide_failed": "문제가 발생했습니다. BloomPrint에서 답변해 주세요.",
        "signoff": "BloomPrint",
        "unsub": "받고 싶지 않으신가요? 여기에서 끄세요: {url}",
        "unsub_note": "계정 관련 안내는 계속 발송됩니다.",
        "contact": "문의는",
        "account_ready": "계정이 준비되었습니다.",
        "unsub_link": "수신 거부",
        "unsub_done_title": "수신을 해지했습니다",
        "unsub_done_body": "다른 사람의 활동에 관한 이메일은 더 이상 오지 않습니다. 계정 관련 메시지는 계속 발송됩니다.",
    },
    "zh": {
        "greeting": "{name} 你好，",
        "open_cta": "打开 BloomPrint",
        "reset_cta": "设置新密码",
        "undo_cta": "保留我的账户",
        "claim_cta": "接手这支球队",
        "claim_taken": "{name} 已经接手了 {team}。",
        "digest_title": "新的评论和消息",
        "decide_approve": "批准",
        "decide_reject": "拒绝",
        "decide_ask": "确认你的回答",
        "decide_approved": "已批准。",
        "decide_rejected": "已拒绝。",
        "decide_gone": "这个请求已经处理过了。",
        "decide_expired": "链接已过期。请打开 BloomPrint 回复。",
        "decide_failed": "出了点问题。请打开 BloomPrint 回复。",
        "signoff": "BloomPrint",
        "unsub": "不想收到这些邮件？可在此关闭：{url}",
        "unsub_note": "与你账号相关的邮件仍会照常发送。",
        "contact": "有问题？请发邮件至",
        "account_ready": "你的账户已就绪。",
        "unsub_link": "退订",
        "unsub_done_title": "已退订",
        "unsub_done_body": "你将不再收到关于他人动态的邮件。与你自己账户有关的邮件仍会发送。",
    },
    "tl": {
        "greeting": "Kumusta {name},",
        "open_cta": "Buksan ang BloomPrint",
        "reset_cta": "Pumili ng bagong password",
        "undo_cta": "Panatilihin ang aking account",
        "claim_cta": "Kunin ang team na ito",
        "claim_taken": "Kinuha na ni {name} ang {team}.",
        "digest_title": "Mga bagong komento at mensahe",
        "decide_approve": "Aprubahan",
        "decide_reject": "Tanggihan",
        "decide_ask": "Kumpirmahin ang iyong sagot",
        "decide_approved": "Naaprubahan.",
        "decide_rejected": "Tinanggihan.",
        "decide_gone": "Nasagot na ito.",
        "decide_expired": "Nag-expire na ang link na ito. Buksan ang BloomPrint para sumagot.",
        "decide_failed": "May nangyaring mali. Buksan ang BloomPrint para sumagot.",
        "signoff": "BloomPrint",
        "unsub": "Ayaw mo ng mga ito? I-off sila: {url}",
        "unsub_note": "Patuloy mo pa ring matatanggap ang mga mensahe tungkol sa sarili mong account.",
        "contact": "May tanong? Mag-email sa",
        "account_ready": "Handa na ang iyong account.",
        "unsub_link": "mag-unsubscribe",
        "unsub_done_title": "Na-unsubscribe na",
        "unsub_done_body": "Hindi ka na makakatanggap ng email tungkol sa aktibidad ng iba. Padadalhan ka pa rin ng mga mensahe tungkol sa sarili mong account.",
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
                  "password_reset", "password_changed",
                  # Closing an account, and the notice that its data is gone.
                  # An opt-out must never be able to hold back either.
                  "account_closed", "account_purged"}


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
    # The two "something changed on your account" messages belong here as well.
    # They told the reader to contact us straight away and then offered them a
    # button that opened the app, which is no use to someone who has just been
    # locked out of it. Choosing a new password is the action that takes the
    # account back in both cases: on a changed email, it is what shuts out
    # whoever changed it.
    if event in ("password_reset", "password_changed", "email_changed"):
        return shell.get("reset_cta") or shell["open_cta"]
    if event == "account_closed":
        return shell.get("undo_cta") or shell["open_cta"]
    return shell["open_cta"]


def render(event: str, lang: str | None, params: dict | None = None, *,
           token: str | None = None, link: str | None = None,
           decide: str | None = None) -> tuple[str, str]:
    """(subject, body) for one event, in the reader's language.

    An unknown language falls back to English: sending in the wrong language
    beats not sending. An unknown event is a programming error and raises.
    """
    from .email_events import EVENTS

    if event not in EVENTS:
        raise KeyError(f"No email copy for event {event!r}")

    code = (lang or DEFAULT_LANG).split("-")[0].lower()
    if code not in EVENTS[event]:
        code = DEFAULT_LANG
    # The same treatment the notifications get. Without it these three messages
    # printed whatever the caller handed over: an English report type whatever
    # the reader's language, and, once a title was attached to it, the raw
    # "scouting_report|Andre Wilkins" with the join character showing.
    params = _localize_params(params or {}, code)
    shell = SHELL.get(code, SHELL[DEFAULT_LANG])

    subject, line = EVENTS[event][code]
    subject = _fmt(subject, params)

    parts: list[str] = []
    name = (params.get("name") or "").strip()
    if name:
        parts.append(_fmt(shell["greeting"], {"name": name}))
    parts.append(_plain(_fmt(line, params)))
    if decide:
        # A message that asks a question offers both answers, and the way into
        # the app underneath in case the reader would rather look first.
        yes, no = decide_urls(decide)
        parts.append(f"{shell['decide_approve']}: {yes}\n"
                     f"{shell['decide_reject']}: {no}")
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
                token: str | None = None, link: str | None = None,
                decide: str | None = None) -> str:
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
    # Laid out from the same words as the text version, so localized the same
    # way too. Two renderings of one message that disagree are a pair that
    # drifts.
    params = _localize_params(params or {}, code)
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
    if decide:
        yes, no = decide_urls(decide)
        kw["cta_label"], kw["cta_url"] = shell["decide_approve"], yes
        kw["cta2_label"], kw["cta2_url"] = shell["decide_reject"], no
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
# `item` is which report or programme a comment is on. It carries a report
# type when the document has no title of its own and the title itself when it
# has one; an unknown value falls through to itself, so both work.
# `report` is the same thing again, under the name the standalone events use.
# It was left out, so those three messages took a humanized string instead and
# printed the raw value: "Jaire shared a scouting report|Andre Wilkins with
# you." A reader saw the plumbing.
ENUM_PARAMS = {"type": "REPORT_TYPES", "kind": "JOB_KINDS", "item": "REPORT_TYPES",
               "report": "REPORT_TYPES"}


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


# A qualified enum: the API value, then what tells one of them from another.
# "scouting_report|Andre" renders as "Scouting Report · Andre" in every
# language, because only the half before the bar is looked up.
#
# It exists because the type alone does not identify anything. A coach with a
# dozen players gets "Andre commented on Scouting Report" and has to go and
# look; the same line naming the report is the difference between a
# notification and a nudge. The alternative — composing the whole name on the
# server — would freeze it in whichever language the writer happened to use,
# and these rows are read by people who chose a different one.
QUALIFIER = "|"
JOIN = " · "

# The params that hold somebody's name. A qualifier equal to one of these is
# dropped, because the sentence has already said it: "Andre commented on
# Scouting Report · Andre" tells you his name twice and which report once.
# Deliberately not every param — a comment whose text happens to be a name must
# not silently strip the qualifier off the document.
NAME_PARAMS = ("player", "coach", "name", "recipient", "profile")


def _localize_params(params: dict, lang: str) -> dict:
    from . import notif_copy

    out = dict(params or {})
    said_already = {
        str(out[k]).strip().casefold()
        for k in NAME_PARAMS
        if isinstance(out.get(k), str) and out[k].strip()
    }
    for name, table in ENUM_PARAMS.items():
        raw = out.get(name)
        if not (isinstance(raw, str) and raw):
            continue
        by_lang = getattr(notif_copy, table)
        words = by_lang.get(lang) or by_lang.get(DEFAULT_LANG) or {}
        head, sep, tail = raw.partition(QUALIFIER)
        # An enum the packs do not know about reads as words rather than as
        # "film_breakdown", which is what the client does with it too.
        said = words.get(head) or head.replace("_", " ")
        keep = bool(sep and tail.strip()
                    and tail.strip().casefold() not in said_already)
        out[name] = f"{said}{JOIN}{tail}" if keep else said
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
                        token: str | None = None, link: str | None = None,
                        decide: str | None = None,
                        decide_label: str | None = None) -> tuple[str, str] | None:
    """(subject, text body) for a notification, framed like any other email."""
    pair = notification_copy(key, lang, params)
    if pair is None:
        return None
    title, body = pair
    code = (lang or DEFAULT_LANG).split("-")[0].lower()
    shell = SHELL.get(code, SHELL[DEFAULT_LANG])

    parts = [body]
    if decide:
        yes, no = decide_urls(decide)
        if decide_label:
            # One action, so one line. An offer to decline something nobody
            # asked you to accept is just a second thing to read.
            parts.append(f"{shell.get(decide_label, shell['decide_approve'])}: {yes}")
        else:
            parts.append(f"{shell['decide_approve']}: {yes}\n"
                         f"{shell['decide_reject']}: {no}")
    parts += [f"{shell['open_cta']}: {link or app_url()}", shell["signoff"]]
    if token:
        # Every one of these is an opt-out-able notification by definition:
        # account mail is not written as a notification row.
        parts.append(_fmt(shell["unsub"], {"url": unsubscribe_url(token)})
                     + "\n" + shell["unsub_note"])
    return title, "\n\n".join(parts)


def render_notification_html(key: str, lang: str | None,
                             params: dict | None = None, *,
                             token: str | None = None, link: str | None = None,
                             decide: str | None = None,
                             decide_label: str | None = None) -> str | None:
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
    if decide:
        yes, no = decide_urls(decide)
        if decide_label:
            kw["cta_label"] = shell.get(decide_label, shell["decide_approve"])
            kw["cta_url"] = yes
        else:
            kw["cta_label"], kw["cta_url"] = shell["decide_approve"], yes
            kw["cta2_label"], kw["cta2_url"] = shell["decide_reject"], no
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
