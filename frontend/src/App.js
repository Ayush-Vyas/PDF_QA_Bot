import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import { saveAs } from "file-saver";
import Papa from "papaparse";
import jsPDF from "jspdf";
import "bootstrap/dist/css/bootstrap.min.css";
import {
  Container,
  Row,
  Col,
  Button,
  Form,
  Card,
  Spinner,
  Navbar,
} from "react-bootstrap";

const API_BASE = process.env.REACT_APP_API_URL || "";

function App() {
  // Core state
  const [file, setFile] = useState(null);
  const [pdfs, setPdfs] = useState([]);
  const [selectedDocs, setSelectedDocs] = useState([]);
  const [question, setQuestion] = useState("");
  const [chatHistory, setChatHistory] = useState([]);

  // UI state
  const [uploading, setUploading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  const chatEndRef = useRef(null);

  // simple session id
  const sessionId = "default-session";

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  // Upload
  const uploadPDF = async () => {
    if (!file) return;
    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("sessionId", sessionId);

    try {
      const res = await axios.post(`${API_BASE}/upload`, formData);
      setPdfs((prev) => [
        ...prev,
        { name: file.name, doc_id: res.data?.doc_id },
      ]);
      setFile(null);
      alert("PDF uploaded!");
    } catch {
      alert("Upload failed.");
    }

    setUploading(false);
  };

  const toggleDocSelection = (docId) => {
    setSelectedDocs((prev) =>
      prev.includes(docId)
        ? prev.filter((id) => id !== docId)
        : [...prev, docId]
    );
  };

  const askQuestion = async () => {
    if (!question.trim() || selectedDocs.length === 0) return;

    setChatHistory((prev) => [...prev, { role: "user", text: question }]);
    setQuestion("");
    setAsking(true);

    try {
      const res = await axios.post(`${API_BASE}/ask`, {
        question,
        doc_ids: selectedDocs,
        sessionId,
      });

      setChatHistory((prev) => [
        ...prev,
        { role: "bot", text: res.data.answer },
      ]);
    } catch {
      setChatHistory((prev) => [
        ...prev,
        { role: "bot", text: "Error getting answer." },
      ]);
    }

    setAsking(false);
  };

  const summarizePDF = async () => {
    if (selectedDocs.length === 0) return;

    setSummarizing(true);

    try {
      const res = await axios.post(`${API_BASE}/summarize`, {
        doc_ids: selectedDocs,
        sessionId,
      });

      setChatHistory((prev) => [
        ...prev,
        { role: "bot", text: res.data.summary },
      ]);
    } catch {
      alert("Error summarizing.");
    }

    setSummarizing(false);
  };

  const compareDocuments = async () => {
    if (selectedDocs.length < 2) return;
    setComparing(true);

    try {
      const res = await axios.post(`${API_BASE}/compare`, {
        doc_ids: selectedDocs,
        sessionId,
      });

      setChatHistory((prev) => [
        ...prev,
        { role: "bot", text: res.data.comparison },
      ]);
    } catch {
      alert("Error comparing.");
    }

    setComparing(false);
  };

  const pageBg = darkMode ? "bg-dark text-light" : "bg-light text-dark";
  const cardClass = darkMode
    ? "bg-secondary text-light shadow"
    : "bg-white text-dark shadow-sm";

  return (
    <div className={pageBg} style={{ minHeight: "100vh" }}>
      <Navbar bg={darkMode ? "dark" : "primary"} variant="dark">
        <Container className="d-flex justify-content-between">
          <Navbar.Brand>🤖 PDF Q&A Bot</Navbar.Brand>
          <Button
            variant="outline-light"
            onClick={() => setDarkMode(!darkMode)}
          >
            {darkMode ? "Light" : "Dark"}
          </Button>
        </Container>
      </Navbar>

      <Container className="mt-4">
        <Card className={`mb-4 ${cardClass}`}>
          <Card.Body>
            <Form>
              <Form.Control
                type="file"
                onChange={(e) => setFile(e.target.files[0])}
              />
              <Button
                className="mt-2"
                onClick={uploadPDF}
                disabled={!file || uploading}
              >
                {uploading ? <Spinner size="sm" /> : "Upload"}
              </Button>
            </Form>
          </Card.Body>
        </Card>

        {pdfs.length > 0 && (
          <Card className={`mb-4 ${cardClass}`}>
            <Card.Body>
              <h5>Select Documents</h5>
              {pdfs.map((pdf) => (
                <Form.Check
                  key={pdf.doc_id}
                  type="checkbox"
                  label={pdf.name}
                  checked={selectedDocs.includes(pdf.doc_id)}
                  onChange={() => toggleDocSelection(pdf.doc_id)}
                />
              ))}
            </Card.Body>
          </Card>
        )}

        <Row className="justify-content-center">
          <Col md={8}>
            <Card className={cardClass}>
              <Card.Body style={{ minHeight: 300 }}>
                <h5>Chat</h5>
                <div style={{ maxHeight: 250, overflowY: "auto" }}>
                  {chatHistory.map((msg, i) => (
                    <div key={i} className="mb-2">
                      <strong>{msg.role === "user" ? "You" : "Bot"}:</strong>{" "}
                      {msg.text}
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>

                <Form
                  className="d-flex gap-2 mt-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    askQuestion();
                  }}
                >
                  <Form.Control
                    type="text"
                    placeholder="Ask a question..."
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    disabled={asking}
                  />
                  <Button disabled={asking || !question.trim()}>
                    {asking ? <Spinner size="sm" /> : "Ask"}
                  </Button>
                </Form>

                <div className="mt-3">
                  <Button
                    variant="warning"
                    className="me-2"
                    onClick={summarizePDF}
                    disabled={summarizing}
                  >
                    {summarizing ? <Spinner size="sm" /> : "Summarize"}
                  </Button>

                  <Button
                    variant="info"
                    onClick={compareDocuments}
                    disabled={selectedDocs.length < 2 || comparing}
                  >
                    {comparing ? <Spinner size="sm" /> : "Compare"}
                  </Button>
                </div>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>
    </div>
  );
}

export default App;