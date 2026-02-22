from fastapi import FastAPI, UploadFile, File, HTTPException
from pydantic import BaseModel, Field, validator
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings
from dotenv import load_dotenv
from transformers import (
    AutoTokenizer,
    AutoModelForSeq2SeqLM,
    AutoModelForCausalLM,
    AutoConfig,
)
import torch
import os
import re
import uvicorn

load_dotenv()

app = FastAPI()

# ==============================
# GLOBAL STATE
# ==============================

vectorstore = None
HF_GENERATION_MODEL = os.getenv("HF_GENERATION_MODEL", "google/flan-t5-base")

generation_tokenizer = None
generation_model = None
generation_is_encoder_decoder = False

# ==============================
# EMBEDDINGS MODEL
# ==============================

embedding_model = HuggingFaceEmbeddings(
    model_name="sentence-transformers/all-MiniLM-L6-v2"
)

# ==============================
# LOAD GENERATION MODEL
# ==============================

def load_generation_model():
    global generation_tokenizer, generation_model, generation_is_encoder_decoder

    if generation_model is not None:
        return generation_tokenizer, generation_model, generation_is_encoder_decoder

    config = AutoConfig.from_pretrained(HF_GENERATION_MODEL)
    generation_is_encoder_decoder = bool(getattr(config, "is_encoder_decoder", False))

    generation_tokenizer = AutoTokenizer.from_pretrained(HF_GENERATION_MODEL)

    if generation_is_encoder_decoder:
        generation_model = AutoModelForSeq2SeqLM.from_pretrained(HF_GENERATION_MODEL)
    else:
        generation_model = AutoModelForCausalLM.from_pretrained(HF_GENERATION_MODEL)

    if torch.cuda.is_available():
        generation_model = generation_model.to("cuda")

    generation_model.eval()
    return generation_tokenizer, generation_model, generation_is_encoder_decoder


def generate_response(prompt: str, max_new_tokens: int = 400) -> str:
    tokenizer, model, is_encoder_decoder = load_generation_model()
    device = next(model.parameters()).device

    encoded = tokenizer(
        prompt,
        return_tensors="pt",
        truncation=True,
        max_length=2048,
    )

    encoded = {k: v.to(device) for k, v in encoded.items()}

    pad_token_id = tokenizer.pad_token_id or tokenizer.eos_token_id

    with torch.no_grad():
        generated_ids = model.generate(
            **encoded,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            temperature=0.0,
            pad_token_id=pad_token_id,
        )

    if is_encoder_decoder:
        text = tokenizer.decode(generated_ids[0], skip_special_tokens=True)
    else:
        input_len = encoded["input_ids"].shape[1]
        new_tokens = generated_ids[0][input_len:]
        text = tokenizer.decode(new_tokens, skip_special_tokens=True)

    return text.strip()


# ==============================
# REQUEST MODELS
# ==============================

class AskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)

    @validator("question")
    def validate_question(cls, v):
        if not v.strip():
            raise ValueError("Question cannot be empty")
        return v.strip()


class SummaryRequest(BaseModel):
    pass


# ==============================
# UPLOAD ENDPOINT
# ==============================

@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    global vectorstore

    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")

    file_location = f"temp_{file.filename}"

    with open(file_location, "wb") as f:
        f.write(await file.read())

    loader = PyPDFLoader(file_location)
    docs = loader.load()

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=800,
        chunk_overlap=150
    )

    chunks = splitter.split_documents(docs)

    if not chunks:
        raise HTTPException(status_code=400, detail="No text found in PDF.")

    vectorstore = FAISS.from_documents(chunks, embedding_model)

    return {"doc_id": file.filename}


# ==============================
# ASK ENDPOINT
# ==============================

@app.post("/ask")
def ask_question(data: AskRequest):
    global vectorstore

    if vectorstore is None:
        return {"answer": "Please upload a PDF first."}

    query = data.question.strip()

    docs = vectorstore.similarity_search(query, k=6)

    if not docs:
        return {"answer": "Not found in document."}

    context = "\n\n".join([doc.page_content for doc in docs])

    prompt = (
        "You are a helpful assistant answering ONLY from the context below.\n\n"
        f"Context:\n{context}\n\n"
        f"Question: {query}\nAnswer:"
    )

    answer = generate_response(prompt, max_new_tokens=300)

    answer = re.sub(r"\s{2,}", " ", answer).strip()

    return {"answer": answer}


# ==============================
# SUMMARIZE ENDPOINT
# ==============================

@app.post("/summarize")
def summarize_pdf(data: SummaryRequest):
    global vectorstore

    if vectorstore is None:
        return {"summary": "Please upload a PDF first."}

    docs = vectorstore.similarity_search("Summarize the document", k=8)

    context = "\n\n".join([doc.page_content for doc in docs])

    prompt = (
        "Summarize the document in 6-8 concise bullet points.\n\n"
        f"Context:\n{context}\n\nSummary:"
    )

    summary = generate_response(prompt, max_new_tokens=350)

    return {"summary": summary}


# ==============================
# RUN SERVER
# ==============================

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=5000, reload=True)