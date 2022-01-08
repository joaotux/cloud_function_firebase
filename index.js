const functions = require("firebase-functions");
const admin = require("firebase-admin");
const request = require("graphql-request");

const client = new request.GraphQLClient('https://my-expenses-98875454.hasura.app/v1/graphql', {
    headers: {
        "content-type": "application/json",
        "x-hasura-admin-secret": "aMZs9lyEHqg9e5CJTw9pOBROyUQAmbh6d4XWCqLzgR776ipRO6O4h5IO2xbmzHHE"
    }
})
admin.initializeApp(functions.config().firebase);

// REGISTER USER WITH REQUIRED CUSTOM CLAIMS
exports.registerUser = functions.https.onCall(async (data, context) => {

    const email = data.email;
    const password = data.password;
    const displayName = data.displayName;

    if (email == null || password == null || displayName == null) {
        throw new functions.https.HttpsError('signup-failed', 'missing information');
    }

    try {
        var userRecord = await admin.auth().createUser({
            email: email,
            emailVerified: true,
            password: password,
            displayName: displayName,
            disabled: false,
        });

        const customClaims = {
            "https://hasura.io/jwt/claims": {
                "x-hasura-default-role": "user",
                "x-hasura-allowed-roles": ["user"],
                "x-hasura-user-id": userRecord.uid
            }
        };

        await admin.auth().setCustomUserClaims(userRecord.uid, customClaims);
        return userRecord.toJSON();

    } catch (e) {
        console.log('Erro ao criar usuário no firebase ' + e);
        // throw new functions.https.HttpsError('signup-failed', JSON.stringify(e, undefined, 2));
    }
});

// SYNC WITH HASURA ON USER CREATE
exports.processSignUp = functions.auth.user().onCreate(async user => {
    const customClaims = {
        "https://hasura.io/jwt/claims": {
            "x-hasura-default-role": "user",
            "x-hasura-allowed-roles": ["user"],
            "x-hasura-user-id": id
        }
    };

    await admin.auth().setCustomUserClaims(id, customClaims);
    
    const id = user.uid;
    const email = user.email;
    const name = user.displayName || "No Name";

    const mutation = `mutation($id: String!, $email: String, $name: String, $score: Int) {
    insert_users(objects: [{
        id: $id,
        email: $email,
        name: $name,
        score: $score
      }]) {
        affected_rows
      }
    }`;
    try {
        const data = await client.request(mutation, {
            id: id,
            email: email,
            name: name,
            score: 0
        });

        return data;
    } catch (e) {
        console.log('Erro ao sincronizar usuário ' + e);
        //throw new functions.https.HttpsError('sync-failed');
    }
});

// SYNC WITH HASURA ON USER DELETE
exports.processDelete = functions.auth.user().onDelete(async (user) => {
    const mutation = `mutation($id: String!) {
        delete_users(where: {id: {_eq: $id}}) {
          affected_rows
        }
    }`;
    const id = user.uid;
    try {
        const data = await client.request(mutation, {
            id: id,
        })
        return data;
    } catch (e) {
       throw new functions.https.HttpsError('sync-failed');

    }
});

// INCREMENT USER SCORE IF THE ANSWER IS CORRECT
exports.checkAnswer = functions.https.onRequest( async (request, response) => {
    const answerID = request.body.event.data.new.answer_id;
    const userID = request.body.event.data.new.user_id;

    const answerQuery = `
    queryAnswer($answerID: uuid!) {
        question_answers(where: {id: {_eq: $answerID}}) {
          is_correct
        }
    }`;

    const incrementMutation = `
    mutationScore($userID: String!) {
        update_users(where: {id: {_eq: $userID}}, _inc: {score: 10}) {
            affected_rows
        }
    }`;

    try {
        const data = await client.request(answerQuery, {
            answerID: answerID,
        })

        const isCorrect = data["question_answers"][0]["is_correct"];
        console.log(isCorrect);
        if (!isCorrect) {
            response.send("correct");
            return;
        } else {
            await client.request(incrementMutation, { userID: userID })
            response.send("correct");
        }

    } catch (e) {
        throw new functions.https.HttpsError(JSON.stringify(e, undefined, 2));
    }
});

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//   functions.logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });
