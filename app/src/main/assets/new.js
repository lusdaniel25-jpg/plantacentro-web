// Reemplaza parte de conectarFirebase en app.js
function conectarFirebase() {
    if (typeof firebase !== 'undefined') {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        
        // Iniciar sesión anónimamente para cumplir con las reglas "auth != null"
        firebase.auth().signInAnonymously()
            .then(() => {
                console.log("Autenticación exitosa");
                database = firebase.database();
                database.ref('.info/connected').on('value', snap => { /* ... resto de tu lógica ... */ });
            })
            .catch((error) => {
                console.error("Error de auth:", error.message);
                notificar("ERROR DE AUTENTICACIÓN", "error");
            });
    }
}