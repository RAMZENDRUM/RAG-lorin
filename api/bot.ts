export default async function handler(req: any, res: any) {
    console.log("Heartbeat received!");
    res.status(200).json({ 
        status: "Alive", 
        message: "Lorin is physically online. If you see this, the bridge is working.",
        received: req.body?.message?.text || "No text"
    });
}
