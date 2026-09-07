// ==============================
// EduNexus Announcement System
// Staff -> Student
// Auto Delete Timer
// ==============================


function loadAnnouncements(){


let page =
document.getElementById(
"page-announce"
);


if(!page)return;


let role =
window.currentUser?.role || "student";


let announcements =
JSON.parse(
localStorage.getItem("announcements")
||
"[]"
);


// AUTO DELETE EXPIRED MESSAGE

let now = Date.now();


announcements =
announcements.filter(a=>{

return now < a.deleteTime;

});


localStorage.setItem(
"announcements",
JSON.stringify(announcements)
);





page.innerHTML = `


<div class="card">


<h2>
📢 Announcements
</h2>


</div>



${
role==="staff"
?

`

<div class="card">


<input
id="annTitle"
class="form-input"
placeholder="Announcement title">


<br><br>


<textarea
id="annMsg"
class="form-input"
placeholder="Message to students">
</textarea>


<br><br>


Delete after:


<label class="form-label">
⏳ Auto Delete After
</label>


<div style="
display:grid;
grid-template-columns:1fr 1fr;
gap:15px;
">


<input
id="annTime"
type="number"
value="10"
class="form-input">


<select
id="annUnit"
class="form-input">


<option value="1000">
Seconds
</option>


<option value="60000">
Minutes
</option>


<option value="3600000">
Hours
</option>


<option value="86400000">
Days
</option>


</select>


</div>


<br>


<button
class="btn btn-primary"
onclick="sendAnnouncement()">

Send Message

</button>


</div>


`

:

""

}




<div class="card">


${
announcements.length===0
?

`
<p class="empty-state">
No announcements
</p>
`

:

announcements.map(a=>`

<div class="annc-item">


<div class="annc-title">

${a.title}

</div>


<div class="annc-body">

${a.message}

</div>


<div class="annc-meta">

From Staff

</div>


${
role==="staff"
?
`

<br>

<div style="margin-top:12px;display:flex;gap:10px;">
    <button
        class="btn btn-primary"
        onclick="editAnnouncement(${a.id})">
        ✏️ Edit
    </button>

    <button
        class="btn btn-danger"
        onclick="removeAnnouncement(${a.id})">
        🗑 Delete
    </button>
</div>

`

:""

}



</div>


`).join("")

}


</div>


`;

}







function sendAnnouncement(){


let title =
document.getElementById(
"annTitle"
).value;


let msg =
document.getElementById(
"annMsg"
).value;



if(
title.trim()==="" ||
msg.trim()===""
){

alert("Enter announcement details");

return;

}

let time =
Number(
document.getElementById(
"annTime"
).value
);



let unit =
Number(
document.getElementById(
"annUnit"
).value
);



let data =
JSON.parse(
localStorage.getItem("announcements")
||
"[]"
);




if(window.editAnnouncementId){

    let obj =
    data.find(x=>x.id===window.editAnnouncementId);

    obj.title = title;
    obj.message = msg;
    obj.created = new Date().toLocaleString();

    window.editAnnouncementId = null;

}else{

    data.push({

        id:Date.now(),
        title:title,
        message:msg,
        created:new Date().toLocaleString(),
        deleteTime: Date.now() + (time * unit)

    });

}


localStorage.setItem(
"announcements",
JSON.stringify(data)
);



loadAnnouncements();


}

function editAnnouncement(id){

    let data =
    JSON.parse(localStorage.getItem("announcements") || "[]");

    let item =
    data.find(x=>x.id===id);

    if(!item) return;

    document.getElementById("annTitle").value = item.title;
    document.getElementById("annMsg").value = item.message;

    window.editAnnouncementId = id;
}

function removeAnnouncement(id){

    if(!confirm("Delete this announcement?")) return;

    let data =
    JSON.parse(localStorage.getItem("announcements") || "[]");

    data = data.filter(a => a.id !== id);

    localStorage.setItem(
        "announcements",
        JSON.stringify(data)
    );

    loadAnnouncements();
}

// AUTO DELETE CHECK EVERY 30 SECOND

setInterval(()=>{


let data =
JSON.parse(
localStorage.getItem("announcements")
||
"[]"
);


let now =
Date.now();


let filtered =
data.filter(
a=>now<a.deleteTime
);


if(
filtered.length !== data.length
){

localStorage.setItem(
"announcements",
JSON.stringify(filtered)
);


let page =
document.getElementById(
"page-announce"
);


if(
page &&
page.classList.contains("active")
){

loadAnnouncements();

}


}


},30000);