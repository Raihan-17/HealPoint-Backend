
const cors = require("cors");
const express = require("express");
const { MongoClient ,ObjectId} = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB configuration
const username = encodeURIComponent(process.env.DB_USERNAME);
const password = encodeURIComponent(process.env.DB_PASSWORD);

const uri = `mongodb+srv://${username}:${password}@cluster0.bade1fx.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri);

let db;

async function connectToMongoDB() {
  await client.connect();

  // Verify that the connection works
  await client.db("admin").command({ ping: 1 });

  db = client.db(process.env.DB_NAME || "healpoint");

  console.log("Connected to MongoDB");
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "HealPoint API is running",
    database: db ? "connected" : "disconnected",
  });
});



const doctorsCollection = () => db.collection("doctors");
const appointmentsCollection = () => db.collection("appointments");



const isValidCalendarDate = (dateString) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return false;
  }

  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const getTodayLocal = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

// GET: Fetch all doctors
app.get("/api/doctors", async (req, res) => {
  try {
    const { speciality } = req.query;

    const filter = speciality ? { speciality } : {};

    const doctors = await doctorsCollection()
      .find(filter)
      .sort({ name: 1 })
      .toArray();

    res.json({ success: true, doctors });
  } catch (error) {
    console.error("Error fetching doctors:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch doctors",
    });
  }
});

// GET: Fetch one doctor by ID
app.get("/api/doctors/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid doctor ID",
      });
    }

    const doctor = await doctorsCollection().findOne({
      _id: new ObjectId(id),
    });

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Doctor not found",
      });
    }

    res.json({ success: true, doctor });
  } catch (error) {
    console.error("Error fetching doctor:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch doctor",
    });
  }
});

// POST: Add a doctor
app.post("/api/doctors", async (req, res) => {
  try {
    const {
      name,
      speciality,
      degree = "",
      experience = "",
      image = "",
      fees = 0,
      rating = null,
      availability = true,
      languages = [],
      address = {},
    } = req.body;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof speciality !== "string" ||
      !speciality.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Doctor name and speciality are required",
      });
    }

    const doctor = {
      name: name.trim(),
      speciality: speciality.trim(),
      degree,
      experience,
      image,
      fees: Number(fees),
      rating: rating === null ? null : Number(rating),
      availability: Boolean(availability),
      languages: Array.isArray(languages) ? languages : [],
      address: {
        line1: address.line1 || "",
        line2: address.line2 || "",
      },
      createdAt: new Date(),
    };

    if (!Number.isFinite(doctor.fees) || doctor.fees < 0) {
      return res.status(400).json({
        success: false,
        message: "Fees must be a valid non-negative number",
      });
    }

    const result = await doctorsCollection().insertOne(doctor);

    res.status(201).json({
      success: true,
      message: "Doctor added successfully",
      doctor: { ...doctor, _id: result.insertedId },
    });
  } catch (error) {
    console.error("Error adding doctor:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add doctor",
    });
  }
});

// POST: Create an appointment request
app.post("/api/appointments", async (req, res) => {
  try {
    const {
      patientName,
      patientEmail,
      patientPhone,
      doctorId,
      appointmentDate,
      appointmentTime,
      reason = "",
    } = req.body;

    // Validate required fields
    if (
      typeof patientName !== "string" ||
      !patientName.trim() ||
      typeof patientEmail !== "string" ||
      !patientEmail.trim() ||
      typeof patientPhone !== "string" ||
      !patientPhone.trim() ||
      typeof doctorId !== "string" ||
      !appointmentDate ||
      !appointmentTime
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required patient and appointment details",
      });
    }

    // Validate doctor ID
    if (!ObjectId.isValid(doctorId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid doctor ID",
      });
    }

    // Validate date and time formats
 if (!isValidCalendarDate(appointmentDate)) {
  return res.status(400).json({
    success: false,
    message: "Please provide a valid appointment date",
  });
}

if (appointmentDate < getTodayLocal()) {
  return res.status(400).json({
    success: false,
    message: "Appointment date cannot be in the past",
  });
}

    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(appointmentTime)) {
      return res.status(400).json({
        success: false,
        message: "Appointment time must use HH:mm format",
      });
    }

    // Check that the doctor exists
    const doctor = await doctorsCollection().findOne({
      _id: new ObjectId(doctorId),
    });

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Doctor not found",
      });
    }

    if (!doctor.availability) {
      return res.status(400).json({
        success: false,
        message: "This doctor is currently unavailable",
      });
    }

    // Prevent the same doctor from having overlapping active appointments
const existingAppointment = await appointmentsCollection().findOne({
  doctorId: doctor._id,
  appointmentDate,
  appointmentTime,
  status: { $in: ["pending", "confirmed"] },
});

if (existingAppointment) {
  return res.status(409).json({
    success: false,
    message: "This time slot is already booked. Please choose another time.",
  });
}

    const appointment = {
      patientName: patientName.trim(),
      patientEmail: patientEmail.trim().toLowerCase(),
      patientPhone: patientPhone.trim(),
      doctorId: doctor._id,
      doctorName: doctor.name,
      speciality: doctor.speciality,
      appointmentDate,
      appointmentTime,
      reason: typeof reason === "string" ? reason.trim() : "",
      status: "pending",
      createdAt: new Date(),
    };

    const result = await appointmentsCollection().insertOne(appointment);

    res.status(201).json({
      success: true,
      message: "Appointment request submitted successfully",
      appointment: {
        ...appointment,
        _id: result.insertedId,
      },
    });
  } catch (error) {
    console.error("Error creating appointment:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create appointment",
    });
  }
});

// GET: Fetch appointments (optionally filter by status)
app.get("/api/appointments", async (req, res) => {
  try {
    const { status } = req.query;
    const allowedStatuses = ["pending", "confirmed", "cancelled"];

    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid appointment status",
      });
    }

    const filter = status ? { status } : {};

    const appointments = await appointmentsCollection()
      .find(filter)
      .sort({ appointmentDate: 1, appointmentTime: 1 })
      .toArray();

    res.json({ success: true, appointments });
  } catch (error) {
    console.error("Error fetching appointments:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch appointments",
    });
  }
});


// GET: Find a patient's appointments by email
app.get("/api/patient-appointments", async (req, res) => {
  try {
    const email = req.query.email;

    if (typeof email !== "string" || !email.trim()) {
      return res.status(400).json({
        success: false,
        message: "Please provide an email address",
      });
    }

    const appointments = await appointmentsCollection()
      .find({
        patientEmail: email.trim().toLowerCase(),
      })
      .sort({ appointmentDate: -1, appointmentTime: -1 })
      .toArray();

    res.json({
      success: true,
      appointments,
    });
  } catch (error) {
    console.error("Error fetching patient appointments:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch patient appointments",
    });
  }
});

// PATCH: Update appointment status
app.patch("/api/appointments/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const allowedStatuses = ["confirmed", "cancelled"];

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid appointment ID",
      });
    }

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be confirmed or cancelled",
      });
    }

    const appointmentId = new ObjectId(id);

    const result = await appointmentsCollection().updateOne(
      { _id: appointmentId },
      {
        $set: {
          status,
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found",
      });
    }

    const appointment = await appointmentsCollection().findOne({
      _id: appointmentId,
    });

    res.json({
      success: true,
      message: `Appointment ${status} successfully`,
      appointment,
    });
  } catch (error) {
    console.error("Error updating appointment status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update appointment status",
    });
  }
});

// DELETE: Remove a doctor
app.delete("/api/doctors/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid doctor ID",
      });
    }

    const result = await doctorsCollection().deleteOne({
      _id: new ObjectId(id),
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Doctor not found",
      });
    }

    res.json({
      success: true,
      message: "Doctor removed successfully",
    });
  } catch (error) {
    console.error("Error deleting doctor:", error);
    res.status(500).json({
      success: false,
      message: "Failed to remove doctor",
    });
  }
});





// Temporary root route
app.get("/", (req, res) => {
  res.send("Welcome to HealPoint API");
});

// Start server only after database connection succeeds
async function startServer() {
  try {
    await connectToMongoDB();

    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

startServer();
