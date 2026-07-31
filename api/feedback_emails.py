"""The acknowledgement a coach gets after sending feedback.

In their language, not ours. A coach whose whole app is Spanish should not get
an English receipt — the language they chose is the one they read.

`{text}` is replaced with what they actually wrote, so the receipt is proof we
have their words rather than a generic "thanks".
"""

# (subject, body) per language. English is the fallback for anything missing.
ACK: dict[str, tuple[str, str]] = {
    "en": ("We got your feedback",
           "Thanks — your feedback has been logged.\n\nWhat you sent:\n{text}\n\n"
           "You don't need to do anything else. If we need more detail, we'll be in touch.\n\n— BloomPrint"),
    "es": ("Hemos recibido tus comentarios",
           "Gracias — tus comentarios han quedado registrados.\n\nEsto es lo que enviaste:\n{text}\n\n"
           "No tienes que hacer nada más. Si necesitamos más detalles, te escribiremos.\n\n— BloomPrint"),
    "fr": ("Nous avons bien reçu votre retour",
           "Merci — votre retour a bien été enregistré.\n\nVoici ce que vous avez envoyé :\n{text}\n\n"
           "Vous n'avez rien d'autre à faire. Si nous avons besoin de précisions, nous vous recontacterons.\n\n— BloomPrint"),
    "pt": ("Recebemos o seu comentário",
           "Obrigado — o seu comentário foi registado.\n\nIsto é o que enviou:\n{text}\n\n"
           "Não precisa de fazer mais nada. Se precisarmos de mais detalhes, entraremos em contacto.\n\n— BloomPrint"),
    "it": ("Abbiamo ricevuto il tuo feedback",
           "Grazie — il tuo feedback è stato registrato.\n\nEcco cosa hai inviato:\n{text}\n\n"
           "Non devi fare altro. Se ci servono altri dettagli, ti contatteremo.\n\n— BloomPrint"),
    "de": ("Wir haben dein Feedback erhalten",
           "Danke — dein Feedback wurde erfasst.\n\nDas hast du gesendet:\n{text}\n\n"
           "Du musst nichts weiter tun. Wenn wir mehr Details brauchen, melden wir uns.\n\n— BloomPrint"),
    "nl": ("We hebben je feedback ontvangen",
           "Bedankt — je feedback is vastgelegd.\n\nDit heb je gestuurd:\n{text}\n\n"
           "Je hoeft verder niets te doen. Als we meer details nodig hebben, nemen we contact op.\n\n— BloomPrint"),
    "sv": ("Vi har fått din återkoppling",
           "Tack — din återkoppling har registrerats.\n\nDetta skickade du:\n{text}\n\n"
           "Du behöver inte göra något mer. Om vi behöver fler detaljer hör vi av oss.\n\n— BloomPrint"),
    "pl": ("Otrzymaliśmy Twoją opinię",
           "Dziękujemy — Twoja opinia została zapisana.\n\nOto co wysłałeś:\n{text}\n\n"
           "Nie musisz robić nic więcej. Jeśli będziemy potrzebować szczegółów, odezwiemy się.\n\n— BloomPrint"),
    "ru": ("Мы получили ваш отзыв",
           "Спасибо — ваш отзыв записан.\n\nВот что вы отправили:\n{text}\n\n"
           "Больше ничего делать не нужно. Если понадобятся подробности, мы напишем.\n\n— BloomPrint"),
    "uk": ("Ми отримали ваш відгук",
           "Дякуємо — ваш відгук записано.\n\nОсь що ви надіслали:\n{text}\n\n"
           "Більше нічого робити не потрібно. Якщо знадобляться подробиці, ми напишемо.\n\n— BloomPrint"),
    "sr": ("Примили смо ваш коментар",
           "Хвала — ваш коментар је забележен.\n\nЕво шта сте послали:\n{text}\n\n"
           "Ништа више не треба да радите. Ако нам затребају детаљи, јавићемо се.\n\n— BloomPrint"),
    "hr": ("Primili smo vašu povratnu informaciju",
           "Hvala — vaša povratna informacija je zabilježena.\n\nEvo što ste poslali:\n{text}\n\n"
           "Ništa više ne morate učiniti. Ako nam zatrebaju detalji, javit ćemo se.\n\n— BloomPrint"),
    "tr": ("Geri bildiriminizi aldık",
           "Teşekkürler — geri bildiriminiz kaydedildi.\n\nGönderdiğiniz:\n{text}\n\n"
           "Başka bir şey yapmanıza gerek yok. Daha fazla ayrıntıya ihtiyacımız olursa size ulaşırız.\n\n— BloomPrint"),
    "ro": ("Am primit feedbackul tău",
           "Mulțumim — feedbackul tău a fost înregistrat.\n\nIată ce ai trimis:\n{text}\n\n"
           "Nu mai trebuie să faci nimic. Dacă avem nevoie de detalii, te contactăm.\n\n— BloomPrint"),
    "el": ("Λάβαμε τα σχόλιά σας",
           "Ευχαριστούμε — τα σχόλιά σας καταγράφηκαν.\n\nΑυτό στείλατε:\n{text}\n\n"
           "Δεν χρειάζεται να κάνετε κάτι άλλο. Αν χρειαστούμε λεπτομέρειες, θα επικοινωνήσουμε.\n\n— BloomPrint"),
    "lt": ("Gavome jūsų atsiliepimą",
           "Ačiū — jūsų atsiliepimas užregistruotas.\n\nŠtai ką išsiuntėte:\n{text}\n\n"
           "Daugiau nieko daryti nereikia. Jei prireiks detalių, susisieksime.\n\n— BloomPrint"),
    "ar": ("لقد استلمنا ملاحظاتك",
           "شكرًا لك — تم تسجيل ملاحظاتك.\n\nهذا ما أرسلته:\n{text}\n\n"
           "لا حاجة لفعل أي شيء آخر. إذا احتجنا إلى تفاصيل إضافية، سنتواصل معك.\n\n— BloomPrint"),
    "he": ("קיבלנו את המשוב שלך",
           "תודה — המשוב שלך נרשם.\n\nזה מה ששלחת:\n{text}\n\n"
           "אין צורך לעשות דבר נוסף. אם נצטרך פרטים נוספים, ניצור קשר.\n\n— BloomPrint"),
    "hi": ("हमें आपकी प्रतिक्रिया मिल गई",
           "धन्यवाद — आपकी प्रतिक्रिया दर्ज कर ली गई है।\n\nआपने यह भेजा:\n{text}\n\n"
           "आपको और कुछ करने की ज़रूरत नहीं है। अधिक जानकारी चाहिए होने पर हम संपर्क करेंगे।\n\n— BloomPrint"),
    "ka": ("თქვენი გამოხმაურება მივიღეთ",
           "მადლობა — თქვენი გამოხმაურება დაფიქსირდა.\n\nაი, რა გამოგზავნეთ:\n{text}\n\n"
           "მეტი არაფრის გაკეთება არ გჭირდებათ. თუ დამატებითი დეტალები დაგვჭირდება, დაგიკავშირდებით.\n\n— BloomPrint"),
    "ja": ("フィードバックを受け取りました",
           "ありがとうございます。いただいたフィードバックを記録しました。\n\n送信内容:\n{text}\n\n"
           "これ以上の操作は必要ありません。詳細が必要な場合はこちらからご連絡します。\n\n— BloomPrint"),
    "ko": ("의견을 받았습니다",
           "감사합니다 — 보내주신 의견이 기록되었습니다.\n\n보내신 내용:\n{text}\n\n"
           "더 하실 일은 없습니다. 추가 정보가 필요하면 연락드리겠습니다.\n\n— BloomPrint"),
    "zh": ("我们已收到你的反馈",
           "谢谢——你的反馈已记录。\n\n你发送的内容：\n{text}\n\n"
           "你无需再做任何操作。如果需要更多细节，我们会与你联系。\n\n— BloomPrint"),
    "tl": ("Natanggap namin ang iyong feedback",
           "Salamat — naitala na ang iyong feedback.\n\nIto ang ipinadala mo:\n{text}\n\n"
           "Wala ka nang kailangang gawin. Kung kailangan namin ng karagdagang detalye, makikipag-ugnayan kami.\n\n— BloomPrint"),
}


def ack_message(language: str | None, text: str) -> tuple[str, str]:
    """Subject and body for the coach's receipt, in their language."""
    subject, body = ACK.get((language or "en").lower(), ACK["en"])
    return subject, body.format(text=text.strip())
