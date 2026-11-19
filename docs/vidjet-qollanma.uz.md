# VidjetUZ: vidjet yaratish

VidjetUZ vidjetlari HTML, CSS va JavaScript asosida ishlaydi. Boshqaruv markazida **Vidjet qo‘shish → Yangi vidjet** orqali vidjet yarating. Dastur uning jildini ochadi va o‘zgarishlarni saqlaganingizda vidjetni qayta yuklaydi.

## Fayllar

Har bir vidjet jildida `widget.json` va `index.html` bo‘ladi. `widget.json` vidjet nomi, o‘lchami, sozlamalari va ruxsatlarini belgilaydi. `index.html` ko‘rinishni chizadi. Misollarni `widgets/` va `templates/` jildlaridan ko‘ring.

## Tarjima

Matnlarni `widget.t({ uz: "Salom", en: "Hello" })` ko‘rinishida yozing. Manifestdagi ko‘rinadigan matnlarga ham `uz` kalitini qo‘shish mumkin.

## API

Vidjet sahifasiga `widget` obyekti avtomatik qo‘shiladi. Mavjud sozlamalar `widget.settings` orqali olinadi. Batafsil API va kod namunalari [asl inglizcha qo‘llanma](widget-guide.en.md)da saqlangan.
