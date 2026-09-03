async function loadStudent() {
  const res = await fetch("get-random-student.php");
  const data = await res.json();

  const photo = document.getElementById("photo");
  const name = document.getElementById("name");

  photo.src = "photos/" + data.photo_path;
  name.textContent = data.name;
}
